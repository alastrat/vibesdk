/** The parts of CJ's API 2.0 responses Estori reads. CJ sends some numbers as strings. */

export interface CjVariant {
	vid: string;
	variantSku: string | null;
	variantNameEn: string | null;
	variantKey: string | null;
	variantImage: string | null;
	variantWeight: number | string | null;
	variantSellPrice: number | string;
}

export interface CjProduct {
	pid: string;
	productNameEn: string;
	productSku: string | null;
	/** 3 is on sale. */
	status: string | number;
	categoryName: string | null;
	/** Property names, such as "Color" or "Color-Size". */
	productKeyEn: string | null;
	productImageSet: string[] | null;
	/** A JSON array of addresses, when productImageSet is missing. */
	productImage: string | null;
	description: string | null;
	materialNameEn: string[] | string | null;
	variants: CjVariant[];
}

export interface CjInventory {
	variantInventories: Array<{ vid: string; inventory: Array<{ countryCode: string; totalInventory: number }> }> | null;
}

export interface CjFreightRequest {
	startCountryCode: string;
	endCountryCode: string;
	zip?: string;
	products: Array<{ vid: string; quantity: number }>;
}

export interface CjFreightOption {
	logisticName: string;
	/** Delivery days, such as "3-5". */
	logisticAging: string | null;
	/** US dollars, including taxes and clearance. */
	totalPostageFee: number | string | null;
	logisticPrice: number | string | null;
}

export interface CjShippingFields {
	shippingCustomerName: string;
	shippingAddress: string;
	shippingAddress2?: string;
	shippingCity: string;
	shippingProvince: string;
	shippingZip: string;
	shippingCountryCode: string;
	shippingCountry: string;
	shippingPhone?: string;
}

export interface CjCreateOrderRequest extends CjShippingFields {
	orderNumber: string;
	logisticName: string;
	fromCountryCode: string;
	/** 3 creates the order without paying it. */
	payType: 3;
	isSandbox: 0 | 1;
	products: Array<{ vid: string; quantity: number }>;
}

export interface CjCreatedOrder {
	orderId: string;
	shipmentOrderId: string | null;
	orderStatus: string | null;
	interceptOrderReasons: Array<{ code: number; message: string }> | null;
}

export interface CjOrderDetail {
	orderId: string;
	orderNum: string | null;
	/** CREATED, IN_CART, UNPAID, UNSHIPPED, SHIPPED, DELIVERED or CANCELLED. */
	orderStatus: string;
	trackNumber: string | null;
	trackingProvider: string | null;
	logisticName: string | null;
	orderAmount: number | string | null;
	productList: Array<{ vid: string; quantity: number }> | null;
}
