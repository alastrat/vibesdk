/** The shopper's address as CJ's order fields. The email is never sent: CJ must not contact shoppers. */

import type { ShippingAddress } from '../supplier';
import type { CjShippingFields } from './types';

function cut(value: string, max: number): string {
	return value.trim().slice(0, max);
}

export function cjShippingFields(address: ShippingAddress, countryName: string): CjShippingFields {
	const phone = address.phone ? address.phone.replace(/(?!^\+)[^\d]/g, '') : '';
	return {
		shippingCustomerName: cut(address.name, 50),
		shippingAddress: cut(address.line1, 500),
		...(address.line2 ? { shippingAddress2: cut(address.line2, 500) } : {}),
		shippingCity: cut(address.city, 50),
		shippingProvince: cut(address.region ?? address.city, 50),
		shippingZip: cut(address.postalCode, 20),
		shippingCountryCode: address.countryCode,
		shippingCountry: countryName,
		...(phone && phone.length <= 20 ? { shippingPhone: phone } : {}),
	};
}
