import type { IAttendeeRepository, IInventoryRepository } from '../repositories/interfaces.js';
import type { AccommodationAvailabilityResponse, NightAvailability, RoomTypeAvailability } from '@smriti/shared';
import { CHECKIN_OPTIONS, CHECKOUT_OPTIONS } from '@smriti/shared';

interface NightOccupancy {
  private: number;
  shared_double: { count: number; rooms: number };
  shared_triple: { count: number; rooms: number };
  extraBeds: number;
}

interface AvailabilityDeps {
  attendeeRepo: IAttendeeRepository;
  inventoryRepo: IInventoryRepository;
}

const NIGHTS = ['2026-08-14', '2026-08-15'] as const;

function nightsForCheckin(checkIn: string): string[] {
  const checkOut = CHECKOUT_OPTIONS[0];
  return NIGHTS.filter(n => checkIn <= n && n < checkOut);
}

function computeNightAvailability(
  occupancy: NightOccupancy,
  totalRooms: number,
): NightAvailability {
  const roomsConsumed = occupancy.private + occupancy.shared_double.rooms + occupancy.shared_triple.rooms;
  const emptyRooms = Math.max(0, totalRooms - roomsConsumed);

  const sdOpenSlots = (Math.ceil(occupancy.shared_double.count / 2) * 2) - occupancy.shared_double.count;
  const stOpenSlots = (Math.ceil(occupancy.shared_triple.count / 3) * 3) - occupancy.shared_triple.count;

  const privateAvail: RoomTypeAvailability = {
    available: emptyRooms > 0,
    remaining: emptyRooms,
  };

  const sdRemaining = sdOpenSlots + (emptyRooms * 2);
  const sdAvail: RoomTypeAvailability = {
    available: sdOpenSlots > 0 || emptyRooms > 0,
    remaining: sdRemaining,
  };

  const stRemaining = stOpenSlots + (emptyRooms * 3);
  const stAvail: RoomTypeAvailability = {
    available: stOpenSlots > 0 || emptyRooms > 0,
    remaining: stRemaining,
  };

  return {
    totalAvailable: emptyRooms,
    types: {
      private: privateAvail,
      shared_double: sdAvail,
      shared_triple: stAvail,
    },
  };
}

function intersectAvailability(nights: NightAvailability[]): NightAvailability {
  if (nights.length === 0) {
    return {
      totalAvailable: 0,
      types: {
        private: { available: false, remaining: 0 },
        shared_double: { available: false, remaining: 0 },
        shared_triple: { available: false, remaining: 0 },
      },
    };
  }
  if (nights.length === 1) return nights[0];

  return {
    totalAvailable: Math.min(...nights.map(n => n.totalAvailable)),
    types: {
      private: {
        available: nights.every(n => n.types.private.available),
        remaining: Math.min(...nights.map(n => n.types.private.remaining)),
      },
      shared_double: {
        available: nights.every(n => n.types.shared_double.available),
        remaining: Math.min(...nights.map(n => n.types.shared_double.remaining)),
      },
      shared_triple: {
        available: nights.every(n => n.types.shared_triple.available),
        remaining: Math.min(...nights.map(n => n.types.shared_triple.remaining)),
      },
    },
  };
}

export class AvailabilityService {
  private readonly attendeeRepo: IAttendeeRepository;
  private readonly inventoryRepo: IInventoryRepository;

  constructor(deps: AvailabilityDeps) {
    this.attendeeRepo = deps.attendeeRepo;
    this.inventoryRepo = deps.inventoryRepo;
  }

  async getAvailability(): Promise<AccommodationAvailabilityResponse> {
    const [inventory, occupancyByNight] = await Promise.all([
      this.inventoryRepo.get(),
      this.attendeeRepo.accommodationByNight(),
    ]);

    const configured = Object.keys(inventory).length > 0;
    if (!configured) {
      const allOpen: NightAvailability = {
        totalAvailable: -1,
        types: {
          private: { available: true, remaining: -1 },
          shared_double: { available: true, remaining: -1 },
          shared_triple: { available: true, remaining: -1 },
        },
      };
      return {
        availability: Object.fromEntries(CHECKIN_OPTIONS.map(d => [d, allOpen])),
        inventoryConfigured: false,
      };
    }

    const perNight: Record<string, NightAvailability> = {};
    for (const night of NIGHTS) {
      const totalRooms = inventory[night] ?? 0;
      const occ = occupancyByNight[night] ?? {
        private: 0,
        shared_double: { count: 0, rooms: 0 },
        shared_triple: { count: 0, rooms: 0 },
        extraBeds: 0,
      };
      perNight[night] = computeNightAvailability(occ, totalRooms);
    }

    const availability: Record<string, NightAvailability> = {};
    for (const checkIn of CHECKIN_OPTIONS) {
      const relevantNights = nightsForCheckin(checkIn).map(n => perNight[n]).filter(Boolean);
      availability[checkIn] = intersectAvailability(relevantNights);
    }

    return { availability, inventoryConfigured: true };
  }

  async isAccommodationAvailable(
    type: string,
    checkIn: string,
  ): Promise<boolean> {
    if (type === 'none') return true;

    const { availability, inventoryConfigured } = await this.getAvailability();
    if (!inventoryConfigured) return true;

    const dateAvail = availability[checkIn];
    if (!dateAvail) return false;

    const typeKey = type as keyof NightAvailability['types'];
    return dateAvail.types[typeKey]?.available ?? false;
  }
}
