class Product {
    constructor(data) {
      this.id = data.id;
      this.sellerId = data.sellerId;
      this.name = data.name;
      this.description = data.description;
      this.category = data.category;
      this.materials = data.materials;
      this.dimensions = {
        length: data.dimensions?.length,
        width: data.dimensions?.width,
        height: data.dimensions?.height,
        unit: data.dimensions?.unit || 'cm'
      };
      this.weight = {
        value: data.weight?.value,
        unit: data.weight?.unit || 'g'
      };
      this.price = data.price;
      this.stock = data.stock;
      this.images = data.images || [];
      this.status = data.status || 'active';
      this.createdAt = data.createdAt || new Date();
      this.updatedAt = data.updatedAt || new Date();
    }
  }