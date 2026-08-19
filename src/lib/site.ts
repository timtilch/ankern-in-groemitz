import apartment from '../data/apartment.json';

const siteUrl = 'https://www.ankern-groemitz.de';

export function getCanonical(pathname = '/') {
  return new URL(pathname, siteUrl).toString();
}

export function getSchema(imageUrls: string[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VacationRental',
    name: apartment.name,
    description: apartment.shortDescription,
    url: siteUrl,
    telephone: apartment.contact.phone,
    email: apartment.contact.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: apartment.contact.street,
      postalCode: apartment.contact.postalCode,
      addressLocality: apartment.contact.city,
      addressCountry: 'DE'
    },
    numberOfRooms: apartment.bedrooms,
    occupancy: {
      '@type': 'QuantitativeValue',
      maxValue: apartment.capacity
    },
    amenityFeature: apartment.highlights.map((name) => ({
      '@type': 'LocationFeatureSpecification',
      name,
      value: true
    })),
    image: imageUrls
  };
}
