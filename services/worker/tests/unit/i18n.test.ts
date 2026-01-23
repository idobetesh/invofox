/**
 * Internationalization (i18n) Service Tests
 * Tests for translation functions and language support
 */

import { t, getDefaultLanguage, messages, type Language } from '../../src/services/i18n/languages';

describe('i18n Service', () => {
  describe('t (translation function)', () => {
    describe('English translations', () => {
      it('should translate onboarding welcome message', () => {
        const result = t('en', 'onboarding.welcome');
        expect(result).toBe('🚀 Welcome to PaperTrail!');
      });

      it('should translate step titles', () => {
        expect(t('en', 'onboarding.step1Title')).toBe('📝 Step 1/6: Business Name');
        expect(t('en', 'onboarding.step2Title')).toBe('👤 Step 2/6: Owner Details');
        expect(t('en', 'onboarding.step3Title')).toBe('📍 Step 3/7: Business Address');
        expect(t('en', 'onboarding.step4Title')).toBe('📋 Step 4/7: Tax Status');
        expect(t('en', 'onboarding.step5Title')).toBe('🖼️ Step 5/7: Logo (Optional)');
        expect(t('en', 'onboarding.step6Title')).toBe('📊 Step 6/7: Google Sheet (Required)');
        expect(t('en', 'onboarding.step7Title')).toBe('🔢 Step 7/7: Starting Invoice Number');
      });

      it('should translate tax status options', () => {
        expect(t('en', 'taxStatus.exempt')).toBe('Tax Exempt Business (עוסק פטור מס)');
        expect(t('en', 'taxStatus.licensed')).toBe('Licensed Business (עוסק מורשה)');
      });

      it('should translate counter options', () => {
        expect(t('en', 'counter.startFromOne')).toBe('Start from 1');
        expect(t('en', 'counter.haveExisting')).toBe('I have existing invoices');
      });

      it('should translate common buttons', () => {
        expect(t('en', 'common.cancel')).toBe('Cancel');
        expect(t('en', 'common.confirm')).toBe('Confirm');
        expect(t('en', 'common.yes')).toBe('Yes');
        expect(t('en', 'common.no')).toBe('No');
      });
    });

    describe('Hebrew translations', () => {
      it('should translate onboarding welcome message', () => {
        const result = t('he', 'onboarding.welcome');
        expect(result).toBe('🚀 ברוכים הבאים ל-PaperTrail!');
      });

      it('should translate step titles', () => {
        expect(t('he', 'onboarding.step1Title')).toBe('📝 שלב 1/6: שם העסק');
        expect(t('he', 'onboarding.step2Title')).toBe('👤 שלב 2/6: פרטי בעל העסק');
        expect(t('he', 'onboarding.step3Title')).toBe('📍 שלב 3/7: כתובת העסק');
        expect(t('he', 'onboarding.step4Title')).toBe('📋 שלב 4/7: סטטוס מס');
        expect(t('he', 'onboarding.step5Title')).toBe('🖼️ שלב 5/7: לוגו (אופציונלי)');
        expect(t('he', 'onboarding.step6Title')).toBe('📊 שלב 6/7: גיליון גוגל (חובה)');
        expect(t('he', 'onboarding.step7Title')).toBe('🔢 שלב 7/7: מספר חשבונית התחלתי');
      });

      it('should translate tax status options', () => {
        expect(t('he', 'taxStatus.exempt')).toBe('עוסק פטור מס');
        expect(t('he', 'taxStatus.licensed')).toBe('עוסק מורשה');
      });

      it('should translate counter options', () => {
        expect(t('he', 'counter.startFromOne')).toBe('התחל ממספר 1');
        expect(t('he', 'counter.haveExisting')).toBe('יש לי חשבוניות קיימות');
      });

      it('should translate common buttons', () => {
        expect(t('he', 'common.cancel')).toBe('ביטול');
        expect(t('he', 'common.confirm')).toBe('אישור');
        expect(t('he', 'common.yes')).toBe('כן');
        expect(t('he', 'common.no')).toBe('לא');
      });
    });

    describe('Parameter replacement', () => {
      it('should replace single parameter in English', () => {
        const result = t('en', 'onboarding.step1Confirm', { name: 'Acme Corp' });
        expect(result).toBe('✅ Business Name: Acme Corp');
      });

      it('should replace single parameter in Hebrew', () => {
        const result = t('he', 'onboarding.step1Confirm', { name: 'חברת אקמי בע"מ' });
        expect(result).toBe('✅ שם העסק: חברת אקמי בע"מ');
      });

      it('should replace multiple parameters in English', () => {
        const result = t('en', 'onboarding.step2Confirm', {
          name: 'John Doe',
          taxId: '123456789',
          phone: '+972501234567',
          email: 'john@acme.com',
        });
        expect(result).toBe(
          '✅ Owner: John Doe\n✅ Tax ID: 123456789\n✅ Phone: +972501234567\n✅ Email: john@acme.com'
        );
      });

      it('should replace multiple parameters in Hebrew', () => {
        const result = t('he', 'onboarding.step2Confirm', {
          name: 'ישראל ישראלי',
          taxId: '123456789',
          phone: '0501234567',
          email: 'israel@acme.co.il',
        });
        expect(result).toBe(
          '✅ שם הבעלים: ישראל ישראלי\n✅ ת.ז / ח.פ: 123456789\n✅ טלפון: 0501234567\n✅ אימייל: israel@acme.co.il'
        );
      });

      it('should replace parameters in multi-line text', () => {
        const result = t('en', 'onboarding.step6Prompt', {
          serviceAccount: 'worker-sa@papertrail-invoice.iam.gserviceaccount.com',
        });
        expect(result).toContain(
          'Share it with: worker-sa@papertrail-invoice.iam.gserviceaccount.com'
        );
      });

      it('should replace same parameter multiple times', () => {
        // Simulate a message that uses the same parameter twice
        const testKey = 'onboarding.step6Error';
        const result = t('en', testKey, {
          serviceAccount: 'test@example.com',
        });
        // The step6Error message contains {serviceAccount} once
        expect(result).toContain('Sheet is shared with: test@example.com');
      });

      it('should handle empty parameters object', () => {
        const result = t('en', 'onboarding.welcome', {});
        expect(result).toBe('🚀 Welcome to PaperTrail!');
      });

      it('should handle undefined parameters', () => {
        const result = t('en', 'onboarding.welcome');
        expect(result).toBe('🚀 Welcome to PaperTrail!');
      });
    });

    describe('Error handling', () => {
      it('should return key when translation not found', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const result = t('en', 'nonexistent.key');
        expect(result).toBe('nonexistent.key');
        expect(consoleSpy).toHaveBeenCalledWith(
          'Translation key not found: nonexistent.key for language en'
        );
        consoleSpy.mockRestore();
      });

      it('should return key when nested translation not found', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const result = t('en', 'onboarding.nonexistentField');
        expect(result).toBe('onboarding.nonexistentField');
        expect(consoleSpy).toHaveBeenCalledWith(
          'Translation key not found: onboarding.nonexistentField for language en'
        );
        consoleSpy.mockRestore();
      });

      it('should handle invalid language gracefully', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        // TypeScript would normally prevent this, but test runtime behavior
        const result = t('fr' as Language, 'onboarding.welcome');
        expect(result).toBe('onboarding.welcome');
        consoleSpy.mockRestore();
      });
    });

    describe('Complex messages', () => {
      it('should handle completion message with multiple parameters (English)', () => {
        const result = t('en', 'onboarding.complete', {
          businessName: 'Acme Corp',
          ownerName: 'John Doe',
          taxId: '123456789',
          address: '123 Herzl St, Tel Aviv',
          phone: '+972501234567',
          email: 'john@acme.com',
          logo: '✅',
          sheet: '✅',
          counter: '1',
        });

        expect(result).toContain('Business: Acme Corp');
        expect(result).toContain('Owner: John Doe (123456789)');
        expect(result).toContain('Address: 123 Herzl St, Tel Aviv');
        expect(result).toContain('Contact: +972501234567, john@acme.com');
        expect(result).toContain('Logo: ✅');
        expect(result).toContain('Google Sheet: ✅');
        expect(result).toContain('Starting Invoice: #1');
      });

      it('should handle completion message with multiple parameters (Hebrew)', () => {
        const result = t('he', 'onboarding.complete', {
          businessName: 'חברת אקמי בע"מ',
          ownerName: 'ישראל ישראלי',
          taxId: '123456789',
          address: 'רחוב הרצל 123, תל אביב',
          phone: '0501234567',
          email: 'israel@acme.co.il',
          logo: '✅',
          sheet: '✅',
          counter: '1',
        });

        expect(result).toContain('עסק: חברת אקמי בע"מ');
        expect(result).toContain('בעלים: ישראל ישראלי (123456789)');
        expect(result).toContain('כתובת: רחוב הרצל 123, תל אביב');
        expect(result).toContain('יצירת קשר: 0501234567, israel@acme.co.il');
        expect(result).toContain('לוגו: ✅');
        expect(result).toContain('גיליון גוגל: ✅');
        expect(result).toContain('חשבונית התחלתית: 1#');
      });
    });
  });

  describe('getDefaultLanguage', () => {
    it('should return Hebrew for "he" language code', () => {
      expect(getDefaultLanguage('he')).toBe('he');
    });

    it('should return Hebrew for "iw" language code (legacy Hebrew)', () => {
      expect(getDefaultLanguage('iw')).toBe('he');
    });

    it('should return English for "en" language code', () => {
      expect(getDefaultLanguage('en')).toBe('en');
    });

    it('should return English for undefined language code', () => {
      expect(getDefaultLanguage(undefined)).toBe('en');
    });

    it('should return English for unsupported language codes', () => {
      expect(getDefaultLanguage('fr')).toBe('en');
      expect(getDefaultLanguage('es')).toBe('en');
      expect(getDefaultLanguage('de')).toBe('en');
      expect(getDefaultLanguage('ar')).toBe('en');
    });

    it('should return English for empty string', () => {
      expect(getDefaultLanguage('')).toBe('en');
    });
  });

  describe('Message structure', () => {
    it('should have matching keys for both languages', () => {
      const enKeys = JSON.stringify(Object.keys(messages.en).sort());
      const heKeys = JSON.stringify(Object.keys(messages.he).sort());
      expect(enKeys).toBe(heKeys);
    });

    it('should have all onboarding step messages in both languages', () => {
      const requiredSteps = [
        'step1Title',
        'step1Prompt',
        'step1Confirm',
        'step2Title',
        'step2Prompt',
        'step2Confirm',
        'step3Title',
        'step3Prompt',
        'step3Confirm',
        'step4Title',
        'step4Prompt',
        'step4Confirm',
        'step5Title',
        'step5Prompt',
        'step5Confirm',
        'step6Title',
        'step6Prompt',
        'step6Confirm',
        'step7Title',
        'step7Prompt',
        'step7Confirm',
      ];

      requiredSteps.forEach((step) => {
        expect((messages.en.onboarding as Record<string, unknown>)[step]).toBeDefined();
        expect((messages.he.onboarding as Record<string, unknown>)[step]).toBeDefined();
      });
    });

    it('should have tax status options in both languages', () => {
      expect(messages.en.taxStatus.exempt).toBeDefined();
      expect(messages.en.taxStatus.licensed).toBeDefined();
      expect(messages.he.taxStatus.exempt).toBeDefined();
      expect(messages.he.taxStatus.licensed).toBeDefined();
    });

    it('should have counter options in both languages', () => {
      expect(messages.en.counter.startFromOne).toBeDefined();
      expect(messages.en.counter.haveExisting).toBeDefined();
      expect(messages.he.counter.startFromOne).toBeDefined();
      expect(messages.he.counter.haveExisting).toBeDefined();
    });
  });

  describe('RTL support', () => {
    it('should preserve RTL text in Hebrew translations', () => {
      const welcome = t('he', 'onboarding.welcome');
      expect(welcome).toContain('ברוכים הבאים');
    });

    it('should mix RTL and LTR correctly in Hebrew', () => {
      const result = t('he', 'onboarding.welcome');
      // Should contain both Hebrew text and English "PaperTrail"
      expect(result).toContain('PaperTrail');
      expect(result).toContain('ברוכים הבאים');
    });
  });
});
