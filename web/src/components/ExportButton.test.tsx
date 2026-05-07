/**
 * ExportButton integration tests — W029
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { server } from "../mocks/server";
import { http, HttpResponse } from "msw";
import ExportButton from "./ExportButton";

const BASE = "http://localhost";
const CID = "test-cid";

beforeEach(() => {
  localStorage.clear();
});

describe("ExportButton", () => {
  it("renders the export button in idle state", () => {
    render(<ExportButton apiBaseUrl={BASE} correlationId={CID} />);
    expect(screen.getByRole("button", { name: /request data export/i })).toBeInTheDocument();
  });

  it("shows success message after export request", async () => {
    render(<ExportButton apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByText(/you'll receive an email/i);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disables the button after export is requested (cooldown)", async () => {
    render(<ExportButton apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByText(/you'll receive an email/i);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows error when export request fails", async () => {
    server.use(
      http.post("*/api/user/export", () => new HttpResponse(null, { status: 500 })),
    );
    render(<ExportButton apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(screen.getByText(/request failed/i)).toBeInTheDocument();
  });

  it("shows cooldown message when localStorage has recent request", () => {
    localStorage.setItem("fithub_export_requested_at", String(Date.now()));
    render(<ExportButton apiBaseUrl={BASE} correlationId={CID} />);
    expect(screen.getByText(/already requested/i)).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
