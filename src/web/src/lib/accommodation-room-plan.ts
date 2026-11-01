export interface GenderCounts {
  male: number;
  female: number;
  other: number;
}

export interface RoomPlan {
  rooms: GenderCounts;
  vacantBeds: GenderCounts;
}

/** Room and vacancy math with separate room pools for each gender. */
export function planRooms(
  type: "private" | "shared_double" | "shared_triple",
  occupants: GenderCounts,
): RoomPlan {
  const capacity = type === "private" ? 1 : type === "shared_double" ? 2 : 3;
  const rooms = {
    male: Math.ceil(occupants.male / capacity),
    female: Math.ceil(occupants.female / capacity),
    other: Math.ceil(occupants.other / capacity),
  };

  return {
    rooms,
    vacantBeds: {
      male: rooms.male * capacity - occupants.male,
      female: rooms.female * capacity - occupants.female,
      other: rooms.other * capacity - occupants.other,
    },
  };
}

export function roomCount(rooms: GenderCounts): number {
  return rooms.male + rooms.female + rooms.other;
}

export function peopleCount(occupants: GenderCounts): number {
  return occupants.male + occupants.female + occupants.other;
}
