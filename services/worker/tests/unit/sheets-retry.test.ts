import {
  isMissingTabError,
  isSheetAlreadyExistsError,
  isTransientSheetsError,
} from '../../src/services/sheets.service';

describe('sheets retry helpers', () => {
  it('detects transient stream and network errors', () => {
    expect(isTransientSheetsError({ code: 'ERR_STREAM_PREMATURE_CLOSE' })).toBe(true);
    expect(isTransientSheetsError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientSheetsError({ response: { status: 429 } })).toBe(true);
    expect(isTransientSheetsError({ response: { status: 503 } })).toBe(true);
  });

  it('ignores non-transient client errors', () => {
    expect(isTransientSheetsError({ response: { status: 400 } })).toBe(false);
    expect(isTransientSheetsError({ response: { status: 404 } })).toBe(false);
    expect(isTransientSheetsError(new Error('permission denied'))).toBe(false);
  });

  it('detects missing Invoices tab parse errors', () => {
    expect(
      isMissingTabError({
        code: 400,
        message: 'Unable to parse range: Invoices!A1:K1',
      })
    ).toBe(true);
    expect(
      isMissingTabError({
        response: {
          status: 400,
          data: { error: { message: 'Requested entity was not found.' } },
        },
      })
    ).toBe(true);
  });

  it('does not treat unrelated 400 errors as missing tab', () => {
    expect(
      isMissingTabError({
        code: 400,
        message: 'Invalid value at foo',
      })
    ).toBe(false);
  });

  it('detects duplicate sheet name errors', () => {
    expect(
      isSheetAlreadyExistsError({
        response: {
          data: {
            error: {
              message:
                'Invalid requests[0].addSheet: A sheet with the name "Invoices" already exists.',
            },
          },
        },
      })
    ).toBe(true);
  });
});
