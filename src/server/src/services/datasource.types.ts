/**
 * CONTRACT: Data source provider interface and shared result types.
 *
 * GUARANTEES:
 *   - DataSourceProvider is a pure interface — no implementation details.
 *   - SheetResult always includes the sheet name, row count, and header-keyed data.
 *   - getRows() maps row 0 (headers) to object keys; remaining rows become values.
 *   - getRawValues() returns the raw string[][] without any header mapping.
 *
 * EXPECTS:
 *   - sheetName is a non-empty string identifying the sheet tab.
 *   - range is an optional A1 notation column range (e.g. "A:D"). Defaults to full sheet.
 */

export interface SheetResult {
  sheet: string;
  rows: number;
  data: Record<string, string>[];
}

export interface DataSourceProvider {
  /**
   * Fetch a named sheet and return rows as header-keyed objects.
   * Row 0 is treated as the header row and becomes the object keys.
   * Throws NotFoundError when the sheet does not exist in the source.
   * Throws AppError (502) on upstream provider failures.
   */
  getRows(sheetName: string, range?: string): Promise<SheetResult>;

  /**
   * Fetch a named sheet and return raw string[][] without header mapping.
   * Throws NotFoundError when the sheet does not exist in the source.
   * Throws AppError (502) on upstream provider failures.
   */
  getRawValues(sheetName: string, range?: string): Promise<string[][]>;
}
