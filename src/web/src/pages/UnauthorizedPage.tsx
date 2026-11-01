import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/Button";
import { SmritiLogo } from "@/components/ui/SmritiLogo";

export default function UnauthorizedPage() {
  useDocumentTitle("Unauthorized");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-6 py-16">
      <div className="flex flex-col items-center text-center max-w-sm w-full">
        {/* Logo */}
        <div className="mb-10">
          <SmritiLogo size={64} />
        </div>

        {/* Status code */}
        <p className="font-heading text-7xl font-bold text-terracotta leading-none mb-4">
          401
        </p>

        {/* Heading */}
        <h1 className="font-heading text-2xl font-bold text-charcoal mb-3">
          Unauthorized
        </h1>

        {/* Message */}
        <p className="font-body text-base text-muted mb-8 leading-relaxed">
          You don&apos;t have permission to view this page. Please check your
          link or contact the organizers if you believe this is a mistake.
        </p>

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          onClick={() => navigate("/register")}
          className="w-full sm:w-auto"
        >
          Go to registration
        </Button>
      </div>
    </div>
  );
}
