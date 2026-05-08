/**
 * Unit tests for DisconnectButton island (T012).
 * Tests the React component: dialog lifecycle, form submissions.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DisconnectButton from "./DisconnectButton";

const DEFAULT_PROPS = {
  platform: "strava",
  platformLabel: "Strava",
};

describe("DisconnectButton", () => {
  it("renders Disconnect button without dialog initially", () => {
    render(<DisconnectButton {...DEFAULT_PROPS} />);
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens confirmation dialog when Disconnect button is clicked", () => {
    render(<DisconnectButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/disconnect strava\?/i)).toBeInTheDocument();
  });

  it("closes dialog when Cancel is clicked", () => {
    render(<DisconnectButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the form with correct action URL for the platform", () => {
    render(<DisconnectButton platform="strava" platformLabel="Strava" />);
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    const form = screen.getByRole("dialog").querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe("/api/connections/strava/disconnect");
    expect(form?.getAttribute("method")).toBe("POST");
  });

  it("hidden delete_data input defaults to false", () => {
    render(<DisconnectButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    const hiddenInput = screen
      .getByRole("dialog")
      .querySelector("input[name='delete_data']") as HTMLInputElement;
    expect(hiddenInput.value).toBe("false");
  });

  it("hidden delete_data input updates to true when checkbox is checked", () => {
    render(<DisconnectButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const hiddenInput = screen
      .getByRole("dialog")
      .querySelector("input[name='delete_data']") as HTMLInputElement;
    expect(hiddenInput.value).toBe("true");
  });

  it("uses the correct platform slug in the form action", () => {
    render(<DisconnectButton platform="apple_health" platformLabel="Apple Health" />);
    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    const form = screen.getByRole("dialog").querySelector("form");
    expect(form?.getAttribute("action")).toBe("/api/connections/apple_health/disconnect");
  });
});
