import archiver from 'archiver';
import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MAX_BULK_DOWNLOAD_OBJECTS, StorageService } from '../services/storage.service';

const ZIP_MIME = 'application/zip';

export class StorageController {
  constructor(private storageService: StorageService) {}

  /**
   * List all buckets
   */
  listBuckets = async (req: Request, res: Response): Promise<void> => {
    try {
      const buckets = await this.storageService.listBuckets();
      res.json({ buckets });
    } catch (error) {
      console.error('Error listing buckets:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list buckets' });
    }
  };

  /**
   * List objects in a bucket
   */
  listObjects = async (req: Request, res: Response): Promise<void> => {
    try {
      const { bucketName } = req.params;
      const prefix = (req.query.prefix as string) || '';
      const maxResults = parseInt(req.query.maxResults as string) || 100;
      const pageToken = req.query.pageToken as string | undefined;

      console.log(
        `Listing objects in bucket "${bucketName}" with prefix="${prefix}", maxResults=${maxResults}, pageToken=${pageToken || 'none'}`
      );

      const result = await this.storageService.listObjects(bucketName, {
        prefix,
        maxResults,
        pageToken,
      });

      console.log(`Found ${result.objects.length} objects in bucket "${bucketName}"`);

      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error listing objects in ${req.params.bucketName}:`, error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to list objects',
        message: errorMessage,
      });
    }
  };

  /**
   * Get object metadata
   */
  getObject = async (req: Request, res: Response): Promise<void> => {
    try {
      const bucketName = req.params.bucketName;

      // Extract object path from the wildcard route
      // Express stores wildcard matches in req.params[0] or we can use req.path
      let objectPath: string;

      // Try to get from params first (if Express populated it)
      if ((req.params as { [key: string]: string })['0']) {
        objectPath = (req.params as { [key: string]: string })['0'];
      } else {
        // Fallback: extract from path
        const fullPath = req.path;
        const objectsPrefix = `/api/storage/buckets/${bucketName}/objects/`;
        objectPath = fullPath.replace(objectsPrefix, '');
      }

      // Decode the path in case it was URL encoded
      try {
        objectPath = decodeURIComponent(objectPath);
      } catch {
        // If decoding fails, use as-is
      }

      console.log(`Getting object: ${bucketName}/${objectPath} (from path: ${req.path})`);

      if (!objectPath || objectPath === '') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Object path is required' });
        return;
      }

      const object = await this.storageService.getObject(bucketName, objectPath);

      if (!object) {
        res.status(StatusCodes.NOT_FOUND).json({ error: 'Object not found' });
        return;
      }

      console.log(
        `Successfully retrieved object: ${bucketName}/${objectPath}, URL: ${object.publicUrl.substring(0, 100)}...`
      );
      res.json(object);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error getting object:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get object',
        message: errorMessage,
      });
    }
  };

  /**
   * Delete an object
   */
  deleteObject = async (req: Request, res: Response): Promise<void> => {
    try {
      const bucketName = req.params.bucketName;

      // Extract object path from the wildcard route
      // Express stores wildcard matches in req.params[0] or we can use req.path
      let objectPath: string;

      // Try to get from params first (if Express populated it)
      if ((req.params as { [key: string]: string })['0']) {
        objectPath = (req.params as { [key: string]: string })['0'];
      } else {
        // Fallback: extract from path
        const fullPath = req.path;
        const objectsPrefix = `/api/storage/buckets/${bucketName}/objects/`;
        objectPath = fullPath.replace(objectsPrefix, '');
      }

      // Decode the path in case it was URL encoded
      try {
        objectPath = decodeURIComponent(objectPath);
      } catch {
        // If decoding fails, use as-is
      }

      console.log(`Deleting object: ${bucketName}/${objectPath} (from path: ${req.path})`);

      if (!objectPath || objectPath === '') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Object path is required' });
        return;
      }

      const { confirm } = req.body;

      if (confirm !== true) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Deletion requires confirm: true' });
        return;
      }

      await this.storageService.deleteObject(bucketName, objectPath);
      res.json({ success: true, message: 'Object deleted successfully' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error deleting object:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete object',
        message: errorMessage,
      });
    }
  };

  /**
   * Delete multiple objects
   */
  deleteMultipleObjects = async (req: Request, res: Response): Promise<void> => {
    try {
      const { bucketName } = req.params;
      const { objectPaths, confirm } = req.body;

      if (confirm !== true) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Deletion requires confirm: true' });
        return;
      }

      if (!Array.isArray(objectPaths) || objectPaths.length === 0) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'objectPaths must be a non-empty array' });
        return;
      }

      await this.storageService.deleteObjects(bucketName, objectPaths);
      res.json({ success: true, deleted: objectPaths.length });
    } catch (error) {
      console.error('Error deleting objects:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to delete objects' });
    }
  };

  /**
   * Download one or more objects (single file or zip).
   */
  downloadMultipleObjects = async (req: Request, res: Response): Promise<void> => {
    try {
      const { bucketName } = req.params;
      const objectPaths = parseDownloadObjectPaths(req.body?.objectPaths);

      if (objectPaths.length === 0) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'objectPaths must be a non-empty array of valid paths' });
        return;
      }

      if (objectPaths.length > MAX_BULK_DOWNLOAD_OBJECTS) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: `Cannot download more than ${MAX_BULK_DOWNLOAD_OBJECTS} objects at once`,
        });
        return;
      }

      if (objectPaths.length === 1) {
        await this.streamSingleObjectDownload(res, bucketName, objectPaths[0]);
        return;
      }

      await this.streamObjectsZipDownload(res, bucketName, objectPaths);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error downloading objects:', error);
      if (!res.headersSent) {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          error: 'Failed to download objects',
          message: errorMessage,
        });
      } else {
        res.end();
      }
    }
  };

  private async streamSingleObjectDownload(
    res: Response,
    bucketName: string,
    objectPath: string
  ): Promise<void> {
    const opened = await this.storageService.openObjectDownloadStream(bucketName, objectPath);
    if (!opened) {
      res.status(StatusCodes.NOT_FOUND).json({ error: 'Object not found', objectPath });
      return;
    }

    res.setHeader('Content-Type', opened.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${escapeContentDispositionFilename(opened.downloadName)}"`
    );
    if (opened.size !== undefined) {
      res.setHeader('Content-Length', String(opened.size));
    }

    opened.stream.on('error', (streamError) => {
      console.error(`Error streaming ${bucketName}/${objectPath}:`, streamError);
      if (!res.headersSent) {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to stream object' });
      } else {
        res.end();
      }
    });

    opened.stream.pipe(res);
  }

  private async streamObjectsZipDownload(
    res: Response,
    bucketName: string,
    objectPaths: string[]
  ): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const skipped = await this.storageService.appendObjectsToZip(bucketName, objectPaths, archive);

    if (skipped.length === objectPaths.length) {
      res.status(StatusCodes.NOT_FOUND).json({
        error: 'None of the selected objects were found',
      });
      return;
    }

    if (skipped.length > 0) {
      const manifest = [
        'Some objects were missing and were not included in this archive:',
        ...skipped.map((path) => `- ${path}`),
      ].join('\n');
      archive.append(manifest, { name: '_missing_objects.txt' });
    }

    const zipName = buildStorageZipFilename(bucketName, objectPaths.length);

    return new Promise((resolve, reject) => {
      res.setHeader('Content-Type', ZIP_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

      archive.on('warning', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          reject(err);
        }
      });
      archive.on('error', reject);
      res.on('close', () => resolve());

      archive.pipe(res);
      archive.finalize().catch(reject);
    });
  }
}

function parseDownloadObjectPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || trimmed.includes('..') || trimmed.startsWith('/')) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    paths.push(trimmed);
  }

  return paths;
}

function escapeContentDispositionFilename(name: string): string {
  return name.replace(/\\/g, '_').replace(/"/g, "'");
}

function buildStorageZipFilename(bucketName: string, count: number): string {
  const safeBucket = bucketName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safeBucket}_${count}_objects_${stamp}.zip`;
}
