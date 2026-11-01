import { calculateTotal, PRICING_DEFAULTS } from '@smriti/shared';
import type { PricingBreakup, PricingRegistration, Registration } from '@smriti/shared';

export class PricingService {
  private config = PRICING_DEFAULTS;

  computePricing(data: Registration): PricingBreakup {
    return calculateTotal(data, this.config);
  }

  computeDeskPricing(data: PricingRegistration): PricingBreakup {
    return calculateTotal(data, this.config);
  }

  /** Single source of truth for child chargeability — delegates to PricingConfig. */
  isChildChargeable(age: number): boolean {
    return age >= this.config.childFreeAgeThreshold;
  }
}
