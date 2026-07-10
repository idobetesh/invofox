import { isTransientGenerationError } from '../../src/services/document-generator/generation-errors';
import { isTransientSheetsError } from '../../src/services/sheets.service';

jest.mock('../../src/services/sheets.service', () => ({
  isTransientSheetsError: jest.fn(),
}));

describe('isTransientGenerationError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to isTransientSheetsError', () => {
    (isTransientSheetsError as jest.Mock).mockReturnValue(true);
    expect(isTransientGenerationError(new Error('sheets'))).toBe(true);
  });

  it('treats transient network codes as retryable', () => {
    (isTransientSheetsError as jest.Mock).mockReturnValue(false);
    expect(isTransientGenerationError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('treats transient gRPC codes as retryable', () => {
    (isTransientSheetsError as jest.Mock).mockReturnValue(false);
    expect(isTransientGenerationError({ code: 14 })).toBe(true);
  });

  it('does not treat validation errors as retryable', () => {
    (isTransientSheetsError as jest.Mock).mockReturnValue(false);
    expect(isTransientGenerationError(new Error('Invoice session is incomplete'))).toBe(false);
  });
});
