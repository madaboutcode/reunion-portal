import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { clearDraft } from "@/hooks/usePersistence";
import { clearAuth } from "@/lib/auth";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";

export default function NewRegistrationPage() {
  const navigate = useNavigate();
  const acceptNew = useFeatureFlag("registration_accept_new");

  useEffect(() => {
    if (!acceptNew) {
      navigate("/register", { replace: true });
      return;
    }
    clearDraft();
    clearAuth();
    navigate("/register", { replace: true });
  }, [navigate, acceptNew]);

  return null;
}
