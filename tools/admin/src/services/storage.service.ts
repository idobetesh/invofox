import { Storage } from '@google-cloud/storage';

export interface StorageBucket {
  name: string;
  location?: string;
  created?: string;
}

export interface StorageObject {
  name: string;
  size: string | number | undefined;
  contentType?: string;
  timeCreated?: string;
  updated?: string;
  publicUrl: string;
}

export interface StorageObjectMetadata extends StorageObject {
  metadata: Record<string, unknown>;
}

export interface ListObjectsResult {
  objects: StorageObject[];
  nextPageToken: string | null;
  hasMore: boolean;
}

export class StorageService {
  constructor(private storage: Storage) {}

  /**
   * List all buckets
   */
  async listBuckets(): Promise<StorageBucket[]> {
    const [buckets] = await this.storage.getBuckets();
    return buckets.map((bucket) => ({
      name: bucket.name,
      location: bucket.metadata.location,
      created: bucket.metadata.timeCreated,
    }));
  }

  /**
   * List objects in a bucket
   */
  async listObjects(
    bucketName: string,
    options: {
      prefix?: string;
      maxResults?: number;
      pageToken?: string;
    } = {}
  ): Promise<ListObjectsResult> {
    try {
      const { prefix = '', maxResults = 100, pageToken } = options;

      const bucket = this.storage.bucket(bucketName);

      // Check if bucket exists
      const [exists] = await bucket.exists();
      if (!exists) {
        throw new Error(`Bucket "${bucketName}" does not exist`);
      }

      const [files, response] = await bucket.getFiles({
        prefix,
        maxResults,
        pageToken: pageToken || undefined,
      });

      const objects = await Promise.all(
        files.map(async (file) => {
          try {
            const [metadata] = await file.getMetadata();

            // Generate URL for viewing
            // Try signed URL first (requires service account key), fallback to public URL
            let publicUrl: string;
            try {
              const [signedUrl] = await file.getSignedUrl({
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000, // 1 hour
              });
              publicUrl = signedUrl;
            } catch {
              // Signed URL generation failed (expected with ADC) - use public URL
              try {
                publicUrl = file.publicUrl();
              } catch {
                // Last resort: construct URL manually
                publicUrl = `https://storage.googleapis.com/${bucketName}/${file.name}`;
              }
            }

            return {
              name: file.name,
              size: metadata.size,
              contentType: metadata.contentType,
              timeCreated: metadata.timeCreated,
              updated: metadata.updated,
              publicUrl,
            };
          } catch (error) {
            console.error(`Error getting metadata for ${file.name}:`, error);
            // Return object with minimal info if metadata fetch fails
            // Construct URL manually as fallback
            const fallbackUrl = `https://storage.googleapis.com/${bucketName}/${file.name}`;
            return {
              name: file.name,
              size: undefined,
              contentType: undefined,
              timeCreated: undefined,
              updated: undefined,
              publicUrl: fallbackUrl,
            };
          }
        })
      );

      // Extract pageToken from response - it might be in different places depending on API version
      const nextPageTokenValue =
        (response as { pageToken?: string })?.pageToken ||
        (response as { nextPageToken?: string })?.nextPageToken ||
        null;

      return {
        objects,
        nextPageToken: nextPageTokenValue,
        hasMore: !!nextPageTokenValue,
      };
    } catch (error) {
      console.error(`Error listing objects in bucket "${bucketName}":`, error);
      throw error;
    }
  }

  /**
   * Get object metadata
   */
  async getObject(bucketName: string, objectPath: string): Promise<StorageObjectMetadata | null> {
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(objectPath);
      const [exists] = await file.exists();

      if (!exists) {
        console.log(`Object does not exist: ${bucketName}/${objectPath}`);
        return null;
      }

      const [metadata] = await file.getMetadata();

      // Generate URL for the object
      // Try signed URL first (requires service account key), fallback to public URL
      let publicUrl: string;
      try {
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });
        publicUrl = signedUrl;
      } catch {
        // Signed URL generation failed (expected with ADC) - use public URL
        try {
          publicUrl = file.publicUrl();
        } catch {
          // Last resort: construct URL manually
          publicUrl = `https://storage.googleapis.com/${bucketName}/${objectPath}`;
        }
      }

      return {
        name: file.name,
        size: metadata.size,
        contentType: metadata.contentType,
        timeCreated: metadata.timeCreated,
        updated: metadata.updated,
        publicUrl,
        metadata: metadata as Record<string, unknown>,
      };
    } catch (error) {
      console.error(`Error getting object ${bucketName}/${objectPath}:`, error);
      throw error;
    }
  }

  /**
   * Delete an object
   */
  async deleteObject(bucketName: string, objectPath: string): Promise<void> {
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    await file.delete();
  }

  /**
   * Delete multiple objects
   */
  async deleteObjects(bucketName: string, objectPaths: string[]): Promise<void> {
    const bucket = this.storage.bucket(bucketName);
    await Promise.all(objectPaths.map((path: string) => bucket.file(path).delete()));
  }

  /**
   * Get storage statistics for all buckets
   */
  async getStorageStatistics(): Promise<{
    totalSize: number;
    totalObjects: number;
    buckets: Array<{
      name: string;
      size: number;
      objectCount: number;
    }>;
  }> {
    try {
      const buckets = await this.listBuckets();
      let totalSize = 0;
      let totalObjects = 0;
      const bucketStats: Array<{ name: string; size: number; objectCount: number }> = [];

      // Get stats for each bucket (with pagination)
      for (const bucket of buckets) {
        let bucketSize = 0;
        let bucketObjectCount = 0;
        let pageToken: string | undefined = undefined;

        do {
          const result = await this.listObjects(bucket.name, {
            maxResults: 1000,
            pageToken,
          });

          result.objects.forEach((obj) => {
            const size = typeof obj.size === 'string' ? parseInt(obj.size, 10) : obj.size || 0;
            bucketSize += size;
            bucketObjectCount++;
          });

          pageToken = result.nextPageToken || undefined;
        } while (pageToken);

        totalSize += bucketSize;
        totalObjects += bucketObjectCount;
        bucketStats.push({
          name: bucket.name,
          size: bucketSize,
          objectCount: bucketObjectCount,
        });
      }

      return {
        totalSize,
        totalObjects,
        buckets: bucketStats,
      };
    } catch (error) {
      console.error('Error getting storage statistics:', error);
      return {
        totalSize: 0,
        totalObjects: 0,
        buckets: [],
      };
    }
  }
}
