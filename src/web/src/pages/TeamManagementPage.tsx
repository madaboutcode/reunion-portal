import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  fetchUsers,
  createUser,
  updateUser,
  resendInvite,
  generateLoginLink,
} from "@/lib/staff-api";
import { getAuthSub } from "@/lib/auth";
import type { StaffUser, StaffScope, StaffPermissions } from "@/lib/staff-types";
import { formatDate } from "@/lib/format-date";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Scope options for the "Restrict to specific pages" control (R14.1.1).
const SCOPE_OPTIONS: { value: StaffScope; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "registration_desk", label: "Registration Desk" },
  { value: "resources", label: "Resources" },
  { value: "reports", label: "Reports" },
  { value: "allocation", label: "Allocation" },
  { value: "admin-tools", label: "Admin Tools" },
  { value: "bank_txns", label: "Bank Transactions" },
];

// ── PermissionsEditor ───────────────────────────────────────────────────────
// Shared toggle + scope checkboxes used by both the Add form and the inline
// per-card edit. `restrict` off (or on with no boxes) → full access.

interface PermissionsEditorProps {
  restrict: boolean;
  scopes: StaffScope[];
  onRestrictChange: (v: boolean) => void;
  onToggleScope: (scope: StaffScope) => void;
}

function PermissionsEditor({
  restrict,
  scopes,
  onRestrictChange,
  onToggleScope,
}: PermissionsEditorProps) {
  return (
    <div className="rounded-lg border border-soft-aqua/50 bg-soft-aqua-light/30 p-3">
      <Switch
        checked={restrict}
        onChange={onRestrictChange}
        label="Restrict to specific pages"
      />
      {restrict ? (
        <fieldset className="mt-2 pl-[56px]">
          <legend className="sr-only">Allowed pages</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 min-h-11 cursor-pointer text-sm text-charcoal"
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-terracotta"
                  checked={scopes.includes(opt.value)}
                  onChange={() => onToggleScope(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {scopes.length === 0 && (
            <p className="text-xs text-muted">
              No pages selected — will be given full access.
            </p>
          )}
        </fieldset>
      ) : (
        <p className="text-xs text-muted mt-1 pl-[56px]">
          Full access to all pages.
        </p>
      )}
    </div>
  );
}

// ── UserCard ──────────────────────────────────────────────────────────────────

interface UserCardProps {
  user: StaffUser;
  currentUserId: number;
  resendingId: number | null;
  generatingId: number | null;
  generatedLink: string | null;
  resolveUserName: (id: number | null) => string | null;
  onDeactivate: (user: StaffUser) => void;
  onReactivate: (user: StaffUser) => void;
  onResend: (userId: number) => void;
  onGenerateLoginLink: (userId: number) => void;
  onSavePermissions: (
    userId: number,
    permissions: StaffPermissions | null,
  ) => Promise<void>;
}

function UserCard({
  user,
  currentUserId,
  resendingId,
  generatingId,
  generatedLink,
  resolveUserName,
  onDeactivate,
  onReactivate,
  onResend,
  onGenerateLoginLink,
  onSavePermissions,
}: UserCardProps) {
  const [editing, setEditing] = useState(false);
  const [restrict, setRestrict] = useState(false);
  const [scopes, setScopes] = useState<StaffScope[]>([]);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [generatedLink]);

  async function copyGeneratedLink() {
    if (!navigator.clipboard?.writeText || !generatedLink) {
      setCopyFailed(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  function openEdit() {
    const current = user.permissions?.scopes ?? [];
    setRestrict(current.length > 0);
    setScopes(current);
    setSaveError(false);
    setJustSaved(false);
    setEditing(true);
  }

  function toggleScope(scope: StaffScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function save() {
    setSaving(true);
    setSaveError(false);
    const permissions =
      restrict && scopes.length > 0 ? { scopes } : null;
    try {
      await onSavePermissions(user.id, permissions);
      setEditing(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card padding={false} className={user.isActive ? "" : "opacity-60"}>
      <div className="p-5 flex items-start gap-4">
        {/* Avatar */}
        <Avatar
          name={user.name}
          colorScheme={user.role === "admin" ? "terracotta" : "cyan"}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-heading font-bold text-charcoal ${!user.isActive ? "line-through" : ""}`}
            >
              {user.name}
            </span>
            <Badge variant={user.role === "admin" ? "error" : "info"}>
              {user.role === "admin" ? "Admin" : "Staff"}
            </Badge>
            {user.role !== "admin" &&
              (user.permissions && user.permissions.scopes.length > 0 ? (
                <Badge variant="warning">
                  Scoped ({user.permissions.scopes.length})
                </Badge>
              ) : (
                <Badge variant="default">Full access</Badge>
              ))}
          </div>
          <p className={`text-sm text-muted ${!user.isActive ? "line-through" : ""}`}>
            {user.email}
          </p>

          {/* Status dot */}
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${user.isActive ? "bg-green-500" : "bg-gray-400"}`}
            />
            <span className="text-xs text-muted">
              {user.isActive ? "Active" : "Deactivated"}
            </span>
          </div>

          {/* Attribution */}
          <p className="text-xs text-muted mt-1">
            {user.createdBy === null
              ? "System bootstrap"
              : `Added by ${resolveUserName(user.createdBy) ?? "unknown"} on ${formatDate(user.createdAt)}`}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {user.id === currentUserId ? (
            <span className="text-xs text-muted italic">
              Cannot deactivate yourself
            </span>
          ) : user.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => onDeactivate(user)}>
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onReactivate(user)}>
              Reactivate
            </Button>
          )}

          {user.isActive && (
            <button
              type="button"
              className="text-xs text-muted hover:text-terracotta transition"
              onClick={() => onResend(user.id)}
            >
              {resendingId === user.id ? "Sent!" : "Resend login link"}
            </button>
          )}

          {user.role === "staff" && user.isActive && (
            <button
              type="button"
              className="min-h-9 px-1 text-xs text-muted hover:text-terracotta transition disabled:opacity-50"
              onClick={() => onGenerateLoginLink(user.id)}
              disabled={generatingId === user.id}
            >
              {generatingId === user.id ? "Generating…" : "Generate login link"}
            </button>
          )}

          {user.role !== "admin" &&
            (justSaved ? (
              <span className="text-xs text-green-600 font-medium">
                Updated ✓
              </span>
            ) : (
              <button
                type="button"
                className="text-xs text-muted hover:text-terracotta transition"
                onClick={() => (editing ? setEditing(false) : openEdit())}
              >
                {editing ? "Cancel" : "Edit permissions"}
              </button>
            ))}
        </div>
      </div>

      {generatedLink && user.role === "staff" && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100">
          <p className="text-xs font-semibold text-charcoal mb-2">
            Login link (expires in 10 minutes)
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={generatedLink}
              aria-label={`Generated login link for ${user.name}`}
              onClick={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 h-9 rounded-lg border border-border bg-gray-50 px-2 text-xs text-charcoal"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void copyGeneratedLink(); }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          {copyFailed && (
            <p className="text-xs text-terracotta mt-2">
              Copy failed. Select the link above and copy it manually.
            </p>
          )}
          <p className="text-xs text-muted mt-2">
            Anyone with this link can sign in as this staff user.
          </p>
        </div>
      )}

      {/* Inline permissions edit */}
      {editing && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100">
          <PermissionsEditor
            restrict={restrict}
            scopes={scopes}
            onRestrictChange={(v) => {
              setRestrict(v);
              if (!v) setScopes([]);
            }}
            onToggleScope={toggleScope}
          />
          {saveError && (
            <p className="text-sm text-terracotta mt-2">
              Failed to update permissions. Please try again.
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              onClick={() => {
                void save();
              }}
            >
              Save
            </Button>
            <button
              type="button"
              className="text-sm text-muted hover:text-charcoal transition"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card padding={false}>
      <div className="p-5 flex items-start gap-4 animate-pulse">
        <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-1/4" />
        </div>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TeamManagementPage() {
  useDocumentTitle("Team");

  const toast = useToast();

  // List state
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [restrictAccess, setRestrictAccess] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<StaffScope[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Deactivate confirm state
  const [deactivateTarget, setDeactivateTarget] = useState<StaffUser | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  // Resend state
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatedLink, setGeneratedLink] = useState<{ userId: number; link: string } | null>(null);

  // Current user
  const sub = getAuthSub();
  const currentUserId = sub ? Number(sub) : -1;

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchUsers();
      setUsers(data.users);
    } catch {
      toast.error("Failed to load team members.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // ── Auto-focus name input when form opens ────────────────────────────────

  useEffect(() => {
    if (showAddForm) {
      const el = document.getElementById("add-staff-name");
      el?.focus();
    }
  }, [showAddForm]);

  // ── User name resolver (in-memory, keyed by user ID) ─────────────────────

  const userNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of users) map.set(u.id, u.name);
    return map;
  }, [users]);

  const resolveUserName = useCallback(
    (id: number | null): string | null => (id !== null ? userNameById.get(id) ?? null : null),
    [userNameById],
  );

  // ── Sorted users ─────────────────────────────────────────────────────────

  const sortedUsers = [...users].sort((a, b) => {
    if (a.role === "admin" && b.role !== "admin") return -1;
    if (a.role !== "admin" && b.role === "admin") return 1;
    return a.name.localeCompare(b.name);
  });

  // ── Form helpers ──────────────────────────────────────────────────────────

  function resetForm() {
    setShowAddForm(false);
    setNewName("");
    setNewEmail("");
    setRestrictAccess(false);
    setSelectedScopes([]);
    setCreateError(null);
  }

  function toggleScope(scope: StaffScope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      // Toggle off, or on with no boxes checked, → null = full access (plan §5).
      const permissions =
        restrictAccess && selectedScopes.length > 0
          ? { scopes: selectedScopes }
          : null;
      await createUser({
        name: newName.trim(),
        email: newEmail.trim(),
        role: "staff",
        permissions,
      });
      toast.success(`Invite sent to ${newEmail.trim()}.`);
      resetForm();
      setLoading(true);
      await loadUsers();
    } catch (err: unknown) {
      const apiErr = err as { error?: string; status?: number };
      if (apiErr.status === 409) {
        setCreateError("A user with this email already exists.");
      } else {
        setCreateError("Failed to create user. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await updateUser(deactivateTarget.id, { isActive: false });
      toast.success("User deactivated.");
      setDeactivateTarget(null);
      setLoading(true);
      await loadUsers();
    } catch {
      toast.error("Failed to deactivate user.");
    } finally {
      setDeactivating(false);
    }
  };

  const handleReactivate = async (user: StaffUser) => {
    try {
      await updateUser(user.id, { isActive: true });
      toast.success("User reactivated.");
      setLoading(true);
      await loadUsers();
    } catch {
      toast.error("Failed to reactivate user.");
    }
  };

  const handleSavePermissions = async (
    userId: number,
    permissions: StaffPermissions | null,
  ) => {
    // Update the single card in place (no skeleton reload) so the inline
    // "Updated ✓" confirmation stays visible.
    const updated = await updateUser(userId, { permissions });
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
  };

  const handleResend = async (userId: number) => {
    setResendingId(userId);
    try {
      await resendInvite(userId);
    } catch {
      toast.error("Failed to resend invite.");
    }
    setTimeout(() => setResendingId(null), 2000);
  };

  const handleGenerateLoginLink = async (userId: number) => {
    setGeneratingId(userId);
    try {
      const response = await generateLoginLink(userId);
      setGeneratedLink({ userId, link: response.link });
      toast.success("Login link generated. Copy it before it expires.");
    } catch {
      toast.error("Failed to generate login link.");
    } finally {
      setGeneratingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-charcoal">Team</h1>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
        >
          + Add Staff Member
        </Button>
      </div>

      {/* Add Staff Form */}
      {showAddForm && (
        <Card padding={false} className="mb-4">
          <form onSubmit={(e) => { void handleCreateUser(e); }} className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label
                  htmlFor="add-staff-name"
                  className="block text-sm font-semibold text-charcoal mb-1.5"
                >
                  Name
                </label>
                <Input
                  id="add-staff-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label
                  htmlFor="add-staff-email"
                  className="block text-sm font-semibold text-charcoal mb-1.5"
                >
                  Email
                </label>
                <Input
                  id="add-staff-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
            </div>
            <div className="mb-3">
              <span className="text-sm text-muted">Role: </span>
              <Badge variant="info">Staff</Badge>
            </div>

            {/* Page access / permissions (R14.1.1) */}
            <div className="mb-4">
              <PermissionsEditor
                restrict={restrictAccess}
                scopes={selectedScopes}
                onRestrictChange={(v) => {
                  setRestrictAccess(v);
                  if (!v) setSelectedScopes([]);
                }}
                onToggleScope={toggleScope}
              />
            </div>

            <p className="text-xs text-muted mb-4">
              A magic link will be sent to their email so they can log in.
            </p>
            {createError && (
              <p className="text-sm text-terracotta mb-3">{createError}</p>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={creating}
                disabled={!newName.trim() || !newEmail.trim()}
              >
                Send Invite
              </Button>
              <button
                type="button"
                className="text-sm text-muted hover:text-charcoal transition"
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* User card list */}
      <div className="flex flex-col gap-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          sortedUsers.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              currentUserId={currentUserId}
              resendingId={resendingId}
              generatingId={generatingId}
              generatedLink={generatedLink?.userId === user.id ? generatedLink.link : null}
              resolveUserName={resolveUserName}
              onDeactivate={setDeactivateTarget}
              onReactivate={handleReactivate}
              onResend={handleResend}
              onGenerateLoginLink={handleGenerateLoginLink}
              onSavePermissions={handleSavePermissions}
            />
          ))
        )}
      </div>

      {/* Deactivate confirmation dialog */}
      <ConfirmDialog
        open={deactivateTarget !== null}
        title={`Deactivate ${deactivateTarget?.name ?? ""}?`}
        message="They won't be able to log in."
        confirmLabel="Deactivate"
        confirmVariant="danger"
        loading={deactivating}
        onConfirm={() => { void handleDeactivateConfirm(); }}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
