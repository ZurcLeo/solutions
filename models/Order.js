class Order {
    constructor(data) {
      this.id = data.id;
      this.sellerId = data.sellerId;
      this.buyerId = data.buyerId;
      this.products = data.products;
      this.totalAmount = data.totalAmount;
      this.commission = data.totalAmount * 0.05; // 5% de comissão
      this.shipping = {
        method: data.shipping?.method,
        trackingCode: data.shipping?.trackingCode,
        status: data.shipping?.status,
        cost: data.shipping?.cost
      };
      this.status = data.status || 'pending';
      this.paymentStatus = data.paymentStatus || 'pending';
      this.createdAt = data.createdAt || new Date();
      this.updatedAt = data.updatedAt || new Date();
    }
  }