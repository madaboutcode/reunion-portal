import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { staffClient } from "@/lib/http";
import type { RoomInventoryResponse } from "@smriti/shared";

const NIGHTS = [
  { key: "2026-08-14", label: "Night of Aug 14" },
  { key: "2026-08-15", label: "Night of Aug 15" },
] as const;

export function RoomInventoryPage() {
  useDocumentTitle("Room Availability");

  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState<RoomInventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms14, setRooms14] = useState("0");
  const [rooms15, setRooms15] = useState("0");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await staffClient<RoomInventoryResponse>(
        "/api/staff/room-inventory",
      );
      setData(res);
      setRooms14(String(res.inventory["2026-08-14"]?.totalRooms ?? 0));
      setRooms15(String(res.inventory["2026-08-15"]?.totalRooms ?? 0));
    } catch {
      toast.error("Failed to load room inventory.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      await staffClient("/api/staff/room-inventory", {
        method: "PUT",
        json: {
          "2026-08-14": Number(rooms14) || 0,
          "2026-08-15": Number(rooms15) || 0,
        },
      });
      toast.success("Room availability updated.");
      await load();
    } catch {
      toast.error("Failed to save room availability.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/staff/resources")}>
          ← Back to Resources
        </Button>
        <h1 className="font-heading text-2xl font-bold text-charcoal">
          Room Availability
        </h1>
      </div>

      <Card>
        {loading ? (
          <div className="animate-pulse space-y-6">
            <div className="h-16 bg-gray-200 rounded" />
            <div className="h-16 bg-gray-200 rounded" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {NIGHTS.map((night) => {
              const entry = data?.inventory[night.key];
              const isOverCommitted = data?.overCommitted[night.key] ?? false;
              const roomsValue = night.key === "2026-08-14" ? rooms14 : rooms15;
              const setRoomsValue =
                night.key === "2026-08-14" ? setRooms14 : setRooms15;

              return (
                <div key={night.key}>
                  <label
                    htmlFor={`rooms-${night.key}`}
                    className="block text-sm font-semibold text-charcoal mb-1.5"
                  >
                    {night.label}
                  </label>
                  <Input
                    id={`rooms-${night.key}`}
                    type="number"
                    value={roomsValue}
                    onChange={(e) => setRoomsValue(e.target.value)}
                  />
                  <p className="text-xs text-muted mt-1.5">
                    {entry?.roomsConsumed ?? 0} rooms occupied
                  </p>
                  {isOverCommitted && entry && (
                    <p className="text-xs text-terracotta mt-1.5 bg-terracotta-light rounded-lg px-3 py-2">
                      Occupancy is {entry.roomsConsumed} rooms. Availability is{" "}
                      {entry.totalRooms}. Over by {entry.roomsConsumed - entry.totalRooms} rooms.
                    </p>
                  )}
                </div>
              );
            })}

            <div>
              <Button variant="primary" loading={saving} onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
