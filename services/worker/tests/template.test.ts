import { escapeHtml } from '../src/services/invoice-generator/template';

describe('Template Utilities', () => {
  describe('escapeHtml', () => {
    it('should escape ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape less than signs', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape greater than signs', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('should escape multiple special characters', () => {
      expect(escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle string with no special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('should handle Hebrew text', () => {
      expect(escapeHtml('שלום עולם')).toBe('שלום עולם');
    });

    it('should prevent XSS injection', () => {
      const malicious = '<script>alert("xss")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });
});
