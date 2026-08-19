import type { ImageMetadata } from 'astro';
import hero from '../assets/images/hero-living.png';
import living from '../assets/images/living-room.png';
import bedroom from '../assets/images/bedroom.png';
import kitchen from '../assets/images/kitchen.png';
import bathroom from '../assets/images/bathroom.png';
import outdoor from '../assets/images/terrace.png';
import exterior from '../assets/images/exterior.png';
import surroundings from '../assets/images/surroundings.png';
import host from '../assets/images/host-portrait.png';
import nearbyCity from '../assets/images/nearby-city.png';
import nearbyZoo from '../assets/images/nearby-zoo.png';
import nearbyStrand from '../assets/images/nearby-strand.png';
import nearbyMarket from '../assets/images/nearby-market.png';

export const mediaLibrary: Record<string, ImageMetadata> = {
  hero,
  living,
  bedroom,
  kitchen,
  bathroom,
  outdoor,
  exterior,
  surroundings,
  host,
  nearbyCity,
  nearbyZoo,
  nearbyStrand,
  nearbyMarket
};
