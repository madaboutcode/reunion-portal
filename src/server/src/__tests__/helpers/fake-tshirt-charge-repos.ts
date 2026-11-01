/**
 * Empty-by-default fakes for ITshirtRepository / IAdditionalChargeRepository.
 *
 * Most route-level tests predate the tshirts/additional_charges feature and
 * don't exercise it — they just need `c.var.tshirtRepo` / `c.var.chargeRepo`
 * to exist so handlers that read them (GET /registrations/:id, GET
 * /resources) don't throw. Both fakes return empty lists for every
 * registration; write methods are unused by these tests and throw if called.
 */
import type { ITshirtRepository, IAdditionalChargeRepository } from '../../repositories/interfaces.js';

export function createEmptyTshirtRepo(): ITshirtRepository {
  return {
    findByRegistration: async () => [],
    findAll: async () => [],
    create: async () => { throw new Error('createEmptyTshirtRepo is read-only'); },
    update: async () => {},
    delete: async () => {},
    countExtras: async () => 0,
  };
}

export function createEmptyChargeRepo(): IAdditionalChargeRepository {
  return {
    findByRegistration: async () => [],
    create: async () => { throw new Error('createEmptyChargeRepo is read-only'); },
    delete: async () => {},
  };
}
