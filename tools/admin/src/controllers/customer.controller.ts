import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CustomerService } from '../services/customer.service';

export class CustomerController {
  constructor(private customerService: CustomerService) {}

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
   */
  getOffboardingPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chat ID' });
        return;
      }

      const preview = await this.customerService.getOffboardingPreview(chatId);
      res.json(preview);
    } catch (error) {
      console.error('Error getting offboarding preview:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to get offboarding preview: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Offboard a customer (delete all their data)
   */
  offboardCustomer = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chat ID' });
        return;
      }

      const result = await this.customerService.offboardCustomer(chatId);
      res.json({
        success: true,
        chatId,
        deleted: result.deleted,
        message: `Customer ${chatId} has been completely removed from the system`,
      });
    } catch (error) {
      console.error('Error offboarding customer:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to offboard customer: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}
