import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { CreateOrderRequestDto } from './order.dto';
import { Order } from './order.entity';
import { CreateOrderResponse } from './proto/order.pb';
import { DecreaseStockResponse, FindOneResponse, ProductServiceClient, PRODUCT_SERVICE_NAME } from './proto/product.pb';

@Injectable()
export class OrderService {
  private productSvc: ProductServiceClient;

  @Inject(PRODUCT_SERVICE_NAME)
  private readonly client: ClientGrpc;

  @InjectRepository(Order)
  private readonly repository: Repository<Order>;

  public onModuleInit(): void {
    this.productSvc = this.client.getService<ProductServiceClient>(PRODUCT_SERVICE_NAME);
  }

  public async createOrder(data: CreateOrderRequestDto): Promise<CreateOrderResponse> {
    const product: FindOneResponse = await firstValueFrom(this.productSvc.findOne({
      id: data.productId
    }))

    if (product.status >= HttpStatus.NOT_FOUND) {
      return {
        id: null, error: ['Product not found'], status: product.status
      }
    }

    if (product.data.stock < data.quantity) {
      return { id: null, error: ['Stock too less'], status: HttpStatus.CONFLICT }
    }

    const order: Order = new Order();
    order.price = product.data.price;
    order.productId = product.data.id;
    order.userId = data.userId;

    await this.repository.save(order);

    const decreaseStockData: DecreaseStockResponse = await firstValueFrom(
      this.productSvc.decreaseStock({ id: data.productId, orderId: order.id })
    );

    if (decreaseStockData.status === HttpStatus.CONFLICT) {
      // deleting order if decreaseStock fails
      await this.repository.delete(order.id);

      return { id: null, error: decreaseStockData.error, status: HttpStatus.CONFLICT };
    }

    return { id: order.id, error: null, status: HttpStatus.OK }
  }
}
