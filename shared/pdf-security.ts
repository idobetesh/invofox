import { getSafeLogoUrl } from './templates/template-utils';

export const DOCUMENT_PAGE_OPTIONS = {
  javaScriptEnabled: false,
  serviceWorkers: 'block' as const,
  acceptDownloads: false,
};

interface DocumentRoute {
  request(): { url(): string; resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface DocumentPage {
  route(pattern: string, handler: (route: DocumentRoute) => Promise<void>): Promise<unknown>;
}

/** Block document-driven requests except fonts and the exact validated logo. */
export async function restrictDocumentRequests(
  page: DocumentPage,
  logoUrl?: string
): Promise<void> {
  const safeLogo = getSafeLogoUrl(logoUrl);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const type = request.resourceType();
    const trustedFont =
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      ((type === 'stylesheet' &&
        url.hostname === 'fonts.googleapis.com' &&
        url.pathname === '/css2') ||
        (type === 'font' &&
          url.hostname === 'fonts.gstatic.com' &&
          url.pathname.startsWith('/s/')));
    if (trustedFont || (type === 'image' && safeLogo === url.href)) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}
