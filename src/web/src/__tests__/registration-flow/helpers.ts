import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { submitRegistration } from "@/lib/api";
import { saveAuth, saveVerifyResponse } from "@/lib/auth";
import { BRANCHES, PRICING_DEFAULTS } from "@/lib/constants";

export { renderWizard, renderWizardWithState } from "./setup-render";

export const PARTICIPATION = {
  full: /Complete Reunion Experience/i,
  campus: /Campus Day Only/i,
  donation: /Donation Only/i,
} as const;

export type ParticipationKind = keyof typeof PARTICIPATION;

export const DEFAULT_ALUMNI: {
  fullName: string;
  branch: (typeof BRANCHES)[number];
  gender: "male" | "female";
  email: string;
  city: string;
  whatsapp: string;
} = {
  fullName: "Dasan Vijayan",
  branch: BRANCHES[0],
  gender: "male",
  email: "dasan@example.com",
  city: "Thrissur",
  whatsapp: "+919876543210",
};

export function continueButton() {
  const alumni = screen.queryByTestId("step1-continue");
  if (alumni) return alumni;
  return screen.getByRole("button", { name: /Continue/i });
}

function alumniComboboxes() {
  return screen.getAllByRole("combobox");
}

export function backButton() {
  return screen.getByRole("button", { name: /← Back/i });
}

export async function clickContinue(user: UserEvent) {
  await user.click(continueButton());
}

export async function selectParticipation(
  user: UserEvent,
  kind: ParticipationKind,
) {
  await user.click(screen.getByRole("button", { name: PARTICIPATION[kind] }));
}

export async function goToAlumniStep(
  user: UserEvent,
  kind: ParticipationKind = "full",
) {
  await selectParticipation(user, kind);
  await clickContinue(user);
  await waitFor(() => {
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });
}

export async function fillAlumniDetails(
  user: UserEvent,
  data: Partial<typeof DEFAULT_ALUMNI> = {},
) {
  const values = { ...DEFAULT_ALUMNI, ...data };

  await user.type(
    screen.getByPlaceholderText("What should we call you?"),
    values.fullName,
  );
  const [branchSelect, genderSelect] = alumniComboboxes();
  await user.selectOptions(branchSelect, values.branch);
  await user.selectOptions(genderSelect, values.gender);
  await user.type(screen.getByPlaceholderText("you@example.com"), values.email);
  await user.type(
    screen.getByPlaceholderText("Your current city"),
    values.city,
  );

  const whatsappInput = screen.getAllByPlaceholderText("+91 98765 43210")[0];
  await user.clear(whatsappInput);
  await user.type(whatsappInput, values.whatsapp);
}

export async function completeAlumniStep(
  user: UserEvent,
  kind: ParticipationKind = "full",
  alumni?: Partial<typeof DEFAULT_ALUMNI>,
) {
  await goToAlumniStep(user, kind);
  await fillAlumniDetails(user, alumni);
  await clickContinue(user);
}

export async function completeAttendeesStep(
  user: UserEvent,
  opts?: { spouseName?: string },
) {
  await waitFor(() => {
    expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
  });
  await user.selectOptions(screen.getByLabelText("T-Shirt Size"), "M");

  if (opts?.spouseName) {
    await user.click(screen.getByRole("switch"));
    await user.type(
      screen.getByPlaceholderText("Partner's name"),
      opts.spouseName,
    );
  }

  await clickContinue(user);
}

export async function completeAccommodationStep(user: UserEvent) {
  await waitFor(() => {
    expect(screen.getByText("My Stay")).toBeInTheDocument();
  });
  await user.click(screen.getByTestId("accom-none"));
  await clickContinue(user);
}

export async function completeAccommodationPrivateRoom(user: UserEvent) {
  await waitFor(() => {
    expect(screen.getByText("My Stay")).toBeInTheDocument();
  });
  await user.click(screen.getByTestId("accom-private"));
  await clickContinue(user);
}

export async function completeAttendeesGroupStep(user: UserEvent) {
  await waitFor(() => {
    expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
  });
  await user.selectOptions(screen.getByLabelText("T-Shirt Size"), "M");
  await user.click(screen.getByRole("switch"));
  await user.type(screen.getByPlaceholderText("Partner's name"), "Karuthamma");
  await user.click(screen.getByTestId("add-child"));
  await user.type(screen.getAllByPlaceholderText("Name (optional)")[0], "Pareekutty");
  await user.type(screen.getAllByPlaceholderText("Age")[0], "3");
  await user.click(screen.getByTestId("add-child"));
  await waitFor(() => {
    expect(screen.getAllByPlaceholderText("Name (optional)").length).toBeGreaterThanOrEqual(2);
  });
  const childNames = screen.getAllByPlaceholderText("Name (optional)");
  const childAges = screen.getAllByPlaceholderText("Age");
  await user.type(childNames[1], "Panchami");
  await user.type(childAges[1], "8");
  await user.click(screen.getByTestId("add-guest"));
  await user.type(screen.getByPlaceholderText("Guest name"), "Appukuttan");
  await user.type(screen.getByPlaceholderText("e.g. Brother"), "Friend");
  await clickContinue(user);
}

export async function advanceToGivingBack(
  user: UserEvent,
  kind: ParticipationKind = "full",
) {
  await completeAlumniStep(user, kind);
  if (kind === "full") {
    await completeAttendeesStep(user);
    await completeAccommodationStep(user);
  } else if (kind === "campus") {
    await completeAttendeesStep(user);
  }
  await waitFor(() => {
    expect(
      screen.getByRole("heading", {
        name: kind === "donation" ? /Donation/i : /Giving Back/i,
      }),
    ).toBeInTheDocument();
  });
}

export async function completePhotoStep(user: UserEvent) {
  await waitFor(() => {
    expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
  });
  const file = new File(["pixels"], "photo.jpg", { type: "image/jpeg" });
  const idFile = new File(["id"], "id.jpg", { type: "image/jpeg" });
  await user.upload(screen.getByTestId("upload-photo-input"), file);
  const idInput = screen.queryByTestId("upload-id-input");
  if (idInput) {
    await user.upload(idInput, idFile);
  }
  await user.click(photoContinueButton());
}

export function photoContinueButton() {
  return screen.getByRole("button", { name: /Continue to Review/i });
}

export async function reachReviewFullCelebration(
  user: UserEvent,
  alumni?: Partial<typeof DEFAULT_ALUMNI>,
) {
  await goToAlumniStep(user, "full");
  await fillAlumniDetails(user, {
    ...DEFAULT_ALUMNI,
    fullName: "Mangalasseri Neelakantan",
    email: "neelakantan@example.com",
    city: "Kochi",
    ...alumni,
  });
  await clickContinue(user);
  await completeAttendeesStep(user);
  await completeAccommodationStep(user);
  await clickContinue(user);
  await completePhotoStep(user);
  await waitFor(() => {
    expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
  });
}

export async function reachReviewCampusOnly(user: UserEvent) {
  await goToAlumniStep(user, "campus");
  await fillAlumniDetails(user, {
    ...DEFAULT_ALUMNI,
    fullName: "Shaji Pappan",
    email: "shajipappan@example.com",
  });
  await clickContinue(user);
  await completeAttendeesStep(user);
  await clickContinue(user);
  await completePhotoStep(user);
  await waitFor(() => {
    expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
  });
}

export async function reachReviewDonationOnly(user: UserEvent) {
  await goToAlumniStep(user, "donation");
  await fillAlumniDetails(user, {
    ...DEFAULT_ALUMNI,
    fullName: "Georgekutty",
    email: "georgekutty@example.com",
  });
  await clickContinue(user);
  // Section A (college contribution) and Section B (donation) both have placeholder "0".
  // Target the last one — Section B, the reunion donation amount.
  const amountInputs = screen.getAllByPlaceholderText("0");
  await user.type(amountInputs[amountInputs.length - 1], "5000");
  await clickContinue(user);
  await completePhotoStep(user);
  await waitFor(() => {
    expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
  });
}

export async function clickProceedToPayment(user: UserEvent) {
  const btn = await waitFor(() => {
    const el = screen.getByTestId("step6-advance");
    expect(el).not.toBeDisabled();
    return el;
  });
  await user.click(btn);
}

export async function expectSubmitAndRedirect() {
  await waitFor(() => {
    expect(submitRegistration).toHaveBeenCalledTimes(1);
  });
  expect(saveAuth).toHaveBeenCalledWith("test-jwt", "1001");
  expect(saveVerifyResponse).toHaveBeenCalled();
  // ?new=1 triggers the one-time email notice banner on the payment page
  expect(window.location.href).toBe("/pay/SMRTTESTREG00001?new=1");
  return vi.mocked(submitRegistration).mock.calls[0][0];
}

export const collegeContributionMin =
  PRICING_DEFAULTS.collegeContributionMinimum;