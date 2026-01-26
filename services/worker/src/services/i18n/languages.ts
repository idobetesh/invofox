/**
 * Internationalization service
 * Supports English and Hebrew languages
 */

export type Language = 'en' | 'he';

export const messages = {
  en: {
    onboarding: {
      welcome: '🚀 Welcome to Invofox!',
      selectLanguage: 'Please select your language:',
      languageSet: '✅ Language: English',

      step1Title: '📝 Step 1/6: Business Name',
      step1Prompt: 'Please send your business name:',
      step1Confirm: '✅ Business Name: {name}',

      step2Title: '👤 Step 2/6: Owner Details',
      step2Prompt:
        'Please send in this format:\nOwner Name, Tax ID, Phone, Email\n\nExample: John Doe, 123456789, +972501234567, john@acme.com',
      step2Confirm: '✅ Owner: {name}\n✅ Tax ID: {taxId}\n✅ Phone: {phone}\n✅ Email: {email}',
      step2Invalid: '❌ Invalid format. Please use: Name, Tax ID, Phone, Email',

      step3Title: '📍 Step 3/7: Business Address',
      step3Prompt: 'Please send your business address:',
      step3Confirm: '✅ Address: {address}',

      step4Title: '📋 Step 4/7: Tax Status',
      step4Prompt: 'Please select your business tax status:',
      step4Confirm: '✅ Tax Status: {status}',

      step5Title: '🖼️ Step 5/7: Logo (Optional)',
      step5Prompt: 'Please send your business logo as an image, or type /skip',
      step5Confirm: '✅ Logo uploaded!',
      step5Skipped: '⏭️ Logo skipped',
      step5Invalid: '❌ Please send an image file or type /skip',

      step6Title: '📊 Step 6/7: Google Sheet (Required)',
      step6Prompt: `To track invoices in Google Sheets:

1. Create a Google Sheet (or use existing)
2. Share it with: {serviceAccount}
   (Give "Editor" access)
3. Send the Sheet ID from the URL

💡 Tip: The Sheet ID is the long string in the URL:
docs.google.com/spreadsheets/d/[THIS_IS_THE_ID]/edit`,
      step6Confirm: '✅ Testing Sheet access...\n✅ Sheet connected! Found tabs: "{tabs}"',
      step6Error: `❌ Could not access sheet. Please check:
1. Sheet ID is correct
2. Sheet is shared with: {serviceAccount}
3. "Editor" permission is granted

Please try again`,
      step6Invalid: '❌ Please send a valid Google Sheet ID',

      step7Title: '🔢 Step 7/7: Starting Invoice Number',
      step7Prompt: 'Do you have existing invoices?',
      step7PromptNumber: 'Please send the starting invoice number:',
      step7Confirm: '✅ Will start from invoice #{number}',
      step7Skipped: '✅ Will start from invoice #1',
      step7Invalid: '❌ Please send a valid number',

      complete: `🎉 Setup Complete!

Your business is configured:
- Business: {businessName}
- Owner: {ownerName} ({taxId})
- Address: {address}
- Contact: {phone}, {email}
- Logo: {logo}
- Google Sheet: {sheet}
- Starting Invoice: #{counter}

You're ready to go! Try these commands:
- Send an invoice photo → Auto-processed
- /invoice → Generate an invoice`,

      alreadyConfigured: '⚠️ Your business is already configured.',
    },

    common: {
      cancel: 'Cancel',
      confirm: 'Confirm',
      yes: 'Yes',
      no: 'No',
      skip: '/skip',
      error: '❌ An error occurred: {error}',
    },

    taxStatus: {
      exempt: 'Tax Exempt Business (עוסק פטור מס)',
      licensed: 'Licensed Business (עוסק מורשה)',
    },

    counter: {
      startFromOne: 'Start from 1',
      haveExisting: 'I have existing invoices',
    },

    invoice: {
      newDocument: '📄 Creating new document\nSelect document type:',
      selectPaymentMethod: '💳 Payment method:',
      selectAction: 'Choose action:',
      invalidFormat:
        '❌ Invalid format. Send in format:\nCustomer name, amount, description, Tax ID (optional)\n(Example: Elad, 275, Wedding album, 123456789)',
      sessionExpired: 'Session expired. Send /invoice again.',
      missingDetails: 'Missing details. Send /invoice again.',
      creating: '⏳ Creating document...',
      created: '✅ {type} number {number} created successfully!',
      error: '❌ Error creating document!',
      errorDetails: '⚠️ Could not create document.\n\nPlease try again with /invoice',
      cancelled: '❌ Document creation cancelled.',
      errorRetry: 'Error. Try again.',
      noAccess:
        '❌ You do not have permission to create invoices.\nSend /invoice in your business group.',
      useInGroup: '❌ Please send /invoice in your business group.',
      typeSelected:
        '📄 Selected: {type}\n\n📝 Send in format:\nCustomer name, amount, description, Tax ID (optional)\n(Example: Elad, 275, Wedding album, 123456789)',
      confirmationTitle: '✅ Confirm document creation:',
      confirmationFields:
        'Type: {type}\nCustomer: {customer}\nDescription: {description}\nAmount: ₪{amount}\nPayment: {payment}\nDate: {date}',
      typeInvoice: 'Invoice',
      typeInvoiceReceipt: 'Invoice-Receipt',
    },

    validation: {
      businessNameInvalid: 'Business name invalid - must be 2-100 characters',
      ownerDetailsInvalid: 'Invalid format. Required: Name, ID, Phone, Email',
      ownerNameInvalid: 'Name invalid - must be 2-100 characters',
      taxIdInvalid: 'Tax ID invalid - must be exactly 9 digits',
      phoneInvalid: 'Phone invalid - example: 0501234567 or +972501234567',
      emailInvalid: 'Email invalid - example: name@example.com',
      addressInvalid: 'Address invalid - must be 5-200 characters',
      sheetIdInvalid:
        'Sheet ID invalid - must be at least 20 characters (letters, numbers, dashes and underscores)',
      counterInvalid: 'Number invalid - please enter a whole number',
      counterNegative: 'Number invalid - must be a positive number',
      digitalSignature: 'Digitally signed computerized document',
      generatedBy: 'Generated by Invofox',
    },
  },

  he: {
    onboarding: {
      welcome: '🚀 ברוכים הבאים ל-Invofox!',
      selectLanguage: 'אנא בחרו שפה:',
      languageSet: '✅ שפה: עברית',

      step1Title: '📝 שלב 1/6: שם העסק',
      step1Prompt: 'אנא שלחו את שם העסק שלכם:',
      step1Confirm: '✅ שם העסק: {name}',

      step2Title: '👤 שלב 2/6: פרטי בעל העסק',
      step2Prompt:
        'אנא שלחו בפורמט הבא:\nשם, ת.ז / ח.פ, טלפון, אימייל\n\nדוגמה: ישראל ישראלי, 123456789, 0501234567, israel@example.com',
      step2Confirm:
        '✅ שם הבעלים: {name}\n✅ ת.ז / ח.פ: {taxId}\n✅ טלפון: {phone}\n✅ אימייל: {email}',
      step2Invalid: '❌ פורמט לא תקין. אנא השתמשו בפורמט: שם, ת.ז, טלפון, אימייל',

      step3Title: '📍 שלב 3/7: כתובת העסק',
      step3Prompt: 'אנא שלחו את כתובת העסק:',
      step3Confirm: '✅ כתובת: {address}',

      step4Title: '📋 שלב 4/7: סטטוס מס',
      step4Prompt: 'אנא בחרו את סטטוס המס של העסק:',
      step4Confirm: '✅ סטטוס מס: {status}',

      step5Title: '🖼️ שלב 5/7: לוגו (אופציונלי)',
      step5Prompt: 'אנא שלחו את לוגו העסק כתמונה, או הקלידו /skip',
      step5Confirm: '✅ לוגו הועלה!',
      step5Skipped: '⏭️ דילגתם על לוגו',
      step5Invalid: '❌ אנא שלחו קובץ תמונה או הקלידו /skip',

      step6Title: '📊 שלב 6/7: גיליון גוגל (חובה)',
      step6Prompt: `כדי לעקוב אחרי חשבוניות בגיליון גוגל:

1. צרו Google Sheet
2. שתפו אותו עם: {serviceAccount}
   (תנו הרשאת "Editor")
3. שלחו את ה-Sheet ID מה-URL

💡 טיפ: ה-Sheet ID הוא המחרוזת הארוכה ב-URL:
docs.google.com/spreadsheets/d/[זה_השדה]/edit`,
      step6Confirm: '✅ בודק גישה לגיליון...\n✅ הגיליון מחובר! נמצאו טאבים: "{tabs}"',
      step6Error: `❌ לא ניתן לגשת לגיליון. אנא בדקו:
1. ה-Sheet ID נכון
2. הגיליון משותף עם: {serviceAccount}
3. ניתנה הרשאת "Editor"

אנא נסו שוב`,
      step6Invalid: '❌ אנא שלחו Sheet ID תקין של Google',

      step7Title: '🔢 שלב 7/7: מספר חשבונית התחלתי',
      step7Prompt: 'האם יש לכם חשבוניות קיימות?',
      step7PromptNumber: 'אנא שלחו את מספר החשבונית ההתחלתי:',
      step7Confirm: '✅ נתחיל מחשבונית מספר {number}#',
      step7Skipped: '✅ נתחיל מחשבונית מספר 1#',
      step7Invalid: '❌ אנא שלחו מספר תקין',

      complete: `🎉 ההגדרה הושלמה!

העסק שלכם מוגדר:
- עסק: {businessName}
- בעלים: {ownerName} ({taxId})
- כתובת: {address}
- יצירת קשר: {phone}, {email}
- לוגו: {logo}
- גיליון גוגל: {sheet}
- חשבונית התחלתית: {counter}#

מוכנים לעבודה! נסו את הפקודות הבאות:
- שלחו תמונת חשבונית ← מעובדת אוטומטית
- /invoice - צרו חשבונית`,

      alreadyConfigured: '⚠️ העסק שלכם כבר מוגדר.',
    },

    common: {
      cancel: 'ביטול',
      confirm: 'אישור',
      yes: 'כן',
      no: 'לא',
      skip: '/skip',
      error: '❌ אירעה שגיאה: {error}',
    },

    taxStatus: {
      exempt: 'עוסק פטור מס',
      licensed: 'עוסק מורשה',
    },

    counter: {
      startFromOne: 'התחל ממספר 1',
      haveExisting: 'יש לי חשבוניות קיימות',
    },

    invoice: {
      newDocument: '📄 יצירת מסמך חדש\nבחר סוג מסמך:',
      selectPaymentMethod: '💳 אמצעי תשלום:',
      selectAction: 'בחר פעולה:',
      invalidFormat:
        '❌ פורמט לא תקין. שלח בפורמט:\nשם לקוח, סכום, תיאור, ח.פ/ע.מ (אופציונלי)\n(לדוגמה: אלעד, 275, אלבום חתונה, 123456789)',
      sessionExpired: 'הפעולה פגה תוקף. שלח /invoice מחדש.',
      missingDetails: 'חסרים פרטים. שלח /invoice מחדש.',
      creating: '⏳ מייצר מסמך...',
      created: '✅ {type} מספר {number} נוצרה בהצלחה!',
      error: '❌ שגיאה ביצירת המסמך!',
      errorDetails: '⚠️ לא הצלחנו ליצור את המסמך.\n\nאנא נסה שוב עם /invoice',
      cancelled: '❌ יצירת המסמך בוטלה.',
      errorRetry: 'שגיאה. נסה שוב.',
      noAccess: '❌ אין לך הרשאה ליצור חשבוניות.\nשלח את הפקודה /invoice בקבוצה של העסק שלך.',
      useInGroup: '❌ אנא שלח את הפקודה /invoice בקבוצה של העסק.',
      typeSelected:
        '📄 נבחר: {type}\n\n📝 שלח בפורמט:\nשם לקוח, סכום, תיאור, ח.פ/ע.מ (אופציונלי)\n(לדוגמה: אלעד, 275, אלבום חתונה, 123456789)',
      confirmationTitle: '✅ אישור יצירת מסמך:',
      confirmationFields:
        'סוג: {type}\nלקוח: {customer}\nתיאור: {description}\nסכום: ₪{amount}\nתשלום: {payment}\nתאריך: {date}',
      typeInvoice: 'חשבונית',
      typeInvoiceReceipt: 'חשבונית-קבלה',
    },

    validation: {
      businessNameInvalid: 'שם העסק לא תקין - חייב להכיל בין 2-100 תווים',
      ownerDetailsInvalid: 'פורמט לא תקין. נדרש: שם, ת.ז/ח.פ, טלפון, אימייל',
      ownerNameInvalid: 'שם לא תקין - חייב להכיל בין 2-100 תווים',
      taxIdInvalid: 'ת.ז/ח.פ לא תקין - חייב להכיל 9 ספרות בדיוק',
      phoneInvalid: 'טלפון לא תקין - דוגמה: 0501234567 או +972501234567',
      emailInvalid: 'אימייל לא תקין - דוגמה: name@example.com',
      addressInvalid: 'כתובת לא תקינה - חייבת להכיל בין 5-200 תווים',
      sheetIdInvalid:
        'Sheet ID לא תקין - חייב להכיל לפחות 20 תווים (אותיות, מספרים, מקפים וקווים תחתונים)',
      counterInvalid: 'מספר לא תקין - אנא הזן מספר שלם',
      counterNegative: 'מספר לא תקין - חייב להיות מספר חיובי',
      digitalSignature: 'מסמך ממוחשב חתום דיגיטלית',
      generatedBy: 'הופק ע"י Invofox',
    },
  },
};

/**
 * Get translated message with parameter replacement
 * @param language - Target language
 * @param key - Translation key (e.g., "onboarding.step1Title")
 * @param params - Optional parameters to replace in the message
 */
export function t(language: Language, key: string, params?: Record<string, string>): string {
  const keys = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = messages[language];

  for (const k of keys) {
    value = value?.[k];
    if (!value) {
      console.error(`Translation key not found: ${key} for language ${language}`);
      return key;
    }
  }

  // Replace parameters
  if (params) {
    Object.keys(params).forEach((param) => {
      value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });
  }

  return value;
}

/**
 * Get default language from Telegram user's language code
 * Falls back to English if not Hebrew
 */
export function getDefaultLanguage(telegramLanguageCode?: string): Language {
  if (telegramLanguageCode === 'he' || telegramLanguageCode === 'iw') {
    return 'he';
  }
  return 'en';
}
