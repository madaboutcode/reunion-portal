import { describe, expect, it } from "vitest";
import { D1AttendeeRepository } from "../repositories/attendee.repo.js";
import { D1RegistrationRepository } from "../repositories/registration.repo.js";

class Statement {
  private readonly sql: string;
  private readonly resolver: (sql: string, mode: "all" | "first") => unknown;

  constructor(
    sql: string,
    resolver: (sql: string, mode: "all" | "first") => unknown,
  ) {
    this.sql = sql;
    this.resolver = resolver;
  }

  bind(): this {
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.resolver(this.sql, "all") as T[] };
  }

  async first<T>(): Promise<T | null> {
    return this.resolver(this.sql, "first") as T | null;
  }
}

class FakeD1 {
  private readonly resolver: (sql: string, mode: "all" | "first") => unknown;

  constructor(
    resolver: (sql: string, mode: "all" | "first") => unknown,
  ) {
    this.resolver = resolver;
  }

  prepare(sql: string): Statement {
    return new Statement(sql, this.resolver);
  }
}

describe("staff report repository correctness", () => {
  it("rounds shared room demand separately for male and female guests", async () => {
    const db = new FakeD1((_sql, mode) => mode === "all"
      ? [
          { accommodation: "shared_double", gender_group: "male", extra_beds: 0, cnt: 1 },
          { accommodation: "shared_double", gender_group: "female", extra_beds: 0, cnt: 1 },
        ]
      : null);
    const repo = new D1AttendeeRepository(db as unknown as D1Database);

    const result = await repo.accommodationByNight();

    expect(result["2026-08-14"].shared_double).toEqual({ count: 2, rooms: 2 });
    expect(result["2026-08-15"].shared_double).toEqual({ count: 2, rooms: 2 });
  });

  it("classifies age 12 in the 6-12 resource band", async () => {
    const db = new FakeD1((sql, mode) => {
      if (mode !== "first") return [];
      return sql.includes("a.age <= 12") && sql.includes("a.age > 12")
        ? { under6: 0, age6to12: 1, age12plus: 0 }
        : { under6: 0, age6to12: 0, age12plus: 1 };
    });
    const repo = new D1AttendeeRepository(db as unknown as D1Database);

    await expect(repo.childrenByAgeBand()).resolves.toEqual({
      under6: 0,
      age6to12: 1,
      age12plus: 0,
    });
  });

  it("returns confirmed donors for recognition and excludes pending pledges", async () => {
    const db = new FakeD1((sql, mode) => {
      if (mode === "first") return { nonPublicCount: 0, nonPublicTotal: 0 };
      const confirmed = [{ displayName: "Confirmed Donor", amount: 10000, felicitationEligible: 0 }];
      const pending = { displayName: "Pending Pledge", amount: 75000, felicitationEligible: 1 };
      return sql.includes("status = 'confirmed'") ? confirmed : [...confirmed, pending];
    });
    const repo = new D1RegistrationRepository(db as unknown as D1Database);

    const result = await repo.donorRecognitionRows(50000);

    expect(result.publicDonors.map((donor) => donor.displayName)).toEqual(["Confirmed Donor"]);
  });

  it("excludes a pending private pledge from the recognition aggregate", async () => {
    const db = new FakeD1((sql, mode) => {
      if (mode === "all") return [];

      // Database fixture semantics:
      // - confirmed publicAck=false donation: 10,000
      // - pending publicAck=false donation: 75,000
      return sql.includes("status = 'confirmed'")
        ? { nonPublicCount: 1, nonPublicTotal: 10000 }
        : { nonPublicCount: 2, nonPublicTotal: 85000 };
    });
    const repo = new D1RegistrationRepository(db as unknown as D1Database);

    const result = await repo.donorRecognitionRows(50000);

    expect(result.nonPublicCount).toBe(1);
    expect(result.nonPublicTotal).toBe(10000);
  });
});
