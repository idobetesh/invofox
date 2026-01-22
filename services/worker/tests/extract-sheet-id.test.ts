/**
 * extractSheetId Unit Tests
 * Tests for Google Sheets URL/ID parsing
 */

import { extractSheetId } from '../src/controllers/onboarding.controller';

describe('extractSheetId', () => {
  describe('URL formats', () => {
    it('should extract ID from standard Google Sheets URL', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/edit';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should extract ID from URL with gid parameter', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/edit#gid=0';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should extract ID from URL with additional query parameters', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/edit?usp=sharing';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should extract ID from URL with both query params and gid', () => {
      const input =
        'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/edit?usp=sharing#gid=123';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should extract ID from mobile URL', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should handle very long sheet IDs (44 characters)', () => {
      const input =
        'https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_AB/edit';
      const result = extractSheetId(input);
      expect(result).toBe('1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_AB');
    });
  });

  describe('Direct ID input', () => {
    it('should accept valid sheet ID directly (exactly 20 chars)', () => {
      const input = '1abc_XyZ123-456defgh';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456defgh');
    });

    it('should accept valid sheet ID with typical length (44 chars)', () => {
      const input = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_ABC';
      const result = extractSheetId(input);
      expect(result).toBe('1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_ABC');
    });

    it('should accept ID with numbers only (21+ chars)', () => {
      const input = '123456789012345678901';
      const result = extractSheetId(input);
      expect(result).toBe('123456789012345678901');
    });

    it('should accept ID with underscores and dashes', () => {
      const input = '1_test-sheet_id_12345';
      const result = extractSheetId(input);
      expect(result).toBe('1_test-sheet_id_12345');
    });
  });

  describe('Invalid inputs', () => {
    it('should reject IDs shorter than 20 characters', () => {
      const input = 'short-id-12345';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject exactly 19 characters', () => {
      const input = '1234567890123456789';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject IDs with invalid characters (spaces)', () => {
      const input = '1abc XyZ123 456def 12345';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject IDs with invalid characters (special chars)', () => {
      const input = '1abc@XyZ123#456def!12345';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject IDs with slashes', () => {
      const input = '1abc/XyZ123/456def/12345';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject non-Google Sheets URLs', () => {
      const input = 'https://example.com/not-a-sheet/1abc_XyZ123-456def';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject Google Drive URLs (not Sheets)', () => {
      const input = 'https://drive.google.com/file/d/1abc_XyZ123-456def/view';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject Google Docs URLs', () => {
      const input = 'https://docs.google.com/document/d/1abc_XyZ123-456def/edit';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject malformed plain text', () => {
      const input = 'not a url or ID at all';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject empty string', () => {
      const input = '';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });

    it('should reject whitespace only', () => {
      const input = '   ';
      const result = extractSheetId(input);
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should extract ID from URL with extra path segments', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def/edit/extra/path';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });

    it('should handle URL without trailing slash or edit', () => {
      const input = 'https://docs.google.com/spreadsheets/d/1abc_XyZ123-456def';
      const result = extractSheetId(input);
      expect(result).toBe('1abc_XyZ123-456def');
    });
  });
});
