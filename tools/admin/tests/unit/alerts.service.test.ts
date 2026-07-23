import { AlertsService } from '../../src/services/alerts.service';

function mockFirestore(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    collection: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: docs.map((d) => ({
              id: d.id,
              data: () => d.data,
            })),
          }),
        }),
      }),
    }),
  };
}

describe('AlertsService', () => {
  const originalWorkerUrl = process.env.WORKER_URL;

  afterEach(() => {
    process.env.WORKER_URL = originalWorkerUrl;
    jest.restoreAllMocks();
  });

  it('reports gemini unavailable from worker health', async () => {
    process.env.WORKER_URL = 'https://worker.example.com';

    const service = new AlertsService(
      mockFirestore([]) as unknown as ConstructorParameters<typeof AlertsService>[0]
    );

    jest
      .spyOn(
        service as unknown as { fetchWorkerGeminiHealth: () => Promise<unknown> },
        'fetchWorkerGeminiHealth'
      )
      .mockResolvedValue({
        reachable: true,
        workerVersion: 'abc1234',
        gemini: {
          status: 'unavailable',
          model: 'gemini-2.0-flash',
          checkedAt: '2026-06-17T13:00:00.000Z',
          errorCode: 'model_not_found',
          errorMessage: 'model no longer available',
        },
      });

    const result = await service.getAlerts();

    expect(result.workerReachable).toBe(true);
    expect(result.diagnostics.recommendedActions.length).toBeGreaterThan(0);
    expect(result.summary.criticalCount).toBeGreaterThanOrEqual(1);
    expect(result.alerts.some((a) => a.type === 'gemini_unavailable')).toBe(true);
  });

  it('warns when worker has legacy health endpoint', async () => {
    process.env.WORKER_URL = 'https://worker.example.com';

    const service = new AlertsService(
      mockFirestore([]) as unknown as ConstructorParameters<typeof AlertsService>[0]
    );

    jest
      .spyOn(
        service as unknown as { fetchWorkerGeminiHealth: () => Promise<unknown> },
        'fetchWorkerGeminiHealth'
      )
      .mockResolvedValue({
        reachable: true,
        workerVersion: 'old',
        gemini: {
          status: 'unknown',
          model: null,
          checkedAt: null,
          errorCode: 'health_endpoint_legacy',
          errorMessage: 'Worker /health has no gemini block',
        },
      });

    const result = await service.getAlerts();

    expect(result.alerts.some((a) => a.type === 'gemini_health_unknown')).toBe(true);
  });

  it('lists recent LLM fallbacks from Firestore jobs', async () => {
    process.env.WORKER_URL = '';

    const fixedNow = new Date('2026-07-15T12:00:00.000Z').getTime();
    const jobTime = fixedNow - 2 * 24 * 60 * 60 * 1000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const service = new AlertsService(
      mockFirestore([
        {
          id: 'chat_1',
          data: {
            status: 'processed',
            llmProvider: 'openai',
            llmFallbackFrom: 'gemini',
            llmFallbackReason: '404 model not found',
            vendorName: 'Test Vendor',
            chatTitle: 'Papertrail',
            receivedAt: new Date(jobTime).toISOString(),
            createdAt: { toMillis: () => jobTime },
          },
        },
      ]) as unknown as ConstructorParameters<typeof AlertsService>[0]
    );

    const result = await service.getAlerts();
    dateNowSpy.mockRestore();

    expect(result.recentFallbacks).toHaveLength(1);
    expect(result.recentLlmJobs.length).toBeGreaterThanOrEqual(1);
    expect(result.llmStats.openaiCount).toBe(1);
    expect(result.alerts.some((a) => a.type === 'llm_fallback')).toBe(true);
  });
});
