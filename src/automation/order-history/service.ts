import { OrderHistoryRepository } from "./repository";
import type { OrderHistoryQuery, OrderHistoryRow, Paged } from "./types";

export class OrderHistoryService {
  constructor(private readonly repo: OrderHistoryRepository = new OrderHistoryRepository()) {}

  async getOrders(userId: number, query: OrderHistoryQuery): Promise<Paged<OrderHistoryRow>> {
    return this.repo.getOrders(userId, {
      page: Math.max(1, query.page || 1),
      pageSize: Math.min(Math.max(query.pageSize || 25, 1), 100),
      search: query.search ?? "",
    });
  }
}

export const orderHistoryService = new OrderHistoryService();
