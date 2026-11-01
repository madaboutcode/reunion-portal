import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/Button";
import { SmritiLogo } from "@/components/ui/SmritiLogo";

export default function NotFoundPage() {
  useDocumentTitle("Page Not Found");
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
          404
        </p>

        {/* Heading */}
        <h1 className="font-heading text-2xl font-bold text-charcoal mb-3">
          Page not found
        </h1>

        {/* Message */}
        <p className="font-body text-base text-muted mb-8 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or may have been
          moved. Head back to the registration page to continue.
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
