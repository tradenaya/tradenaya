export interface TripFormData {
  title: string;
  slug: string;
  destination: string;

  durationDays: number;
  durationNights: number;

  description: string;

  tripTypeId: number;
  status: string;

  departureDate: Date | undefined;
  returnDate: Date | undefined;
  bookingLastDate: Date | undefined;

  departureTime: string;
  returnTime: string;

  totalSeats: number;

  price: number;
  discountedPrice: number;

  itinerary: ItineraryItem[];

  inclusions: string[];

  exclusions: string[];

  images: string[];
}

export interface ItineraryItem {
  dayNumber: number;
  title: string;
  description: string;
}

export interface TripType {
  id: number;
  name: string;
}

export interface TripStatus {
  status_code: string;
  status_name: string;
}