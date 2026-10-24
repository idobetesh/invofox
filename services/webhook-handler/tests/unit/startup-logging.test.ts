const mockInfo = jest.fn();
jest.mock('../../src/logger', () => ({ info: mockInfo, fatal: jest.fn() }));
jest.mock('../../src/app', () => ({ listen: (_port: number, callback: () => void) => callback() }));
jest.mock('../../src/config', () => ({
  loadConfig: () => ({
    port: 8080,
    projectId: 'test',
    queueName: 'test',
    workerUrl: 'https://worker.example',
    webhookSecretPath: 'startup-secret-must-not-log',
  }),
}));

it('does not log the webhook credential at startup', () => {
  jest.isolateModules(() => require('../../src/index'));
  expect(mockInfo).toHaveBeenCalled();
  expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('startup-secret-must-not-log');
});
