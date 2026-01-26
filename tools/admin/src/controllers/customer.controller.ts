import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CustomerService } from '../services/customer.service';
import { OffboardingService } from '../offboarding/offboarding.service';

export class CustomerController {
  constructor(
    private customerService: CustomerService,
    private offboardingService?: OffboardingService
  ) {}

  /**
   * List all customers
   */
  listCustomers = async (req: Request, res: Response): Promise<void> => {
    try {
      const customers = await this.customerService.listCustomers();
      res.json({ customers });
    } catch (error) {
      console.error('Error listing customers:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to list customers: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Get offboarding preview for a customer
   * Uses new comprehensive offboarding service if available, falls back to old service
   */
  getOffboardingPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chat ID' });
        return;
      }

      if (this.offboardingService) {
        // Use new comprehensive service and transform to UI format
        const preview = await this.offboardingService.previewBusinessOffboarding(chatId);
        const uiPreview = this.transformPreviewForUI(chatId, preview);
        res.json(uiPreview);
      } else {
        // Fallback to old service (backward compatibility)
        const preview = await this.customerService.getOffboardingPreview(chatId);
        res.json(preview);
      }
    } catch (error) {
      console.error('Error getting offboarding preview:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to get offboarding preview: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Transform new OffboardingService preview format to old UI-compatible format
   */
  private transformPreviewForUI(chatId: number, preview: any) {
    return {
      chatId,
      customerName: preview.name,
      summary: {
        businessConfig: (preview.collections['business_config']?.count || 0) > 0,
        logo: {
          exists: (preview.storage['logos']?.count || 0) > 0,
          path: preview.storage['logos']?.paths?.[0],
        },
        onboardingSession: (preview.collections['onboarding_sessions']?.count || 0) > 0,
        counters: {
          count: preview.collections['invoice_counters']?.count || 0,
          docIds: preview.collections['invoice_counters']?.docIds || [],
        },
        generatedInvoices: {
          count: preview.collections['generated_invoices']?.count || 0,
          docIds: preview.collections['generated_invoices']?.docIds || [],
        },
        generatedPDFs: {
          count: preview.storage['generated_pdfs']?.count || 0,
          paths: preview.storage['generated_pdfs']?.paths || [],
        },
        receivedInvoices: {
          count: preview.storage['received_invoices']?.count || 0,
          paths: preview.storage['received_invoices']?.paths || [],
        },
        userMappings: {
          count: preview.collections['user_customer_mapping']?.count || 0,
          userIds: preview.collections['user_customer_mapping']?.docIds || [],
        },
        processingJobs: {
          count: preview.collections['invoice_jobs']?.count || 0,
          docIds: preview.collections['invoice_jobs']?.docIds || [],
        },
      },
      totalItems: preview.totalItems,
    };
  }

  /**
   * Offboard a customer (delete all their data)
   * Uses new comprehensive offboarding service if available, falls back to old service
   */
  offboardCustomer = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chat ID' });
        return;
      }

      if (this.offboardingService) {
        // Use new comprehensive service
        const report = await this.offboardingService.offboardBusiness(chatId);
        res.json({
          success: true,
          chatId,
          deleted: report.firestoreDocs + report.storageFiles,
          report,
          message: `Customer ${chatId} has been completely removed from the system`,
        });
      } else {
        // Fallback to old service (backward compatibility)
        const result = await this.customerService.offboardCustomer(chatId);
        res.json({
          success: true,
          chatId,
          deleted: result.deleted,
          message: `Customer ${chatId} has been completely removed from the system`,
        });
      }
    } catch (error) {
      console.error('Error offboarding customer:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to offboard customer: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}
