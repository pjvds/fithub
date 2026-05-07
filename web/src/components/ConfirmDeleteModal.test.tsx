/**
 * ConfirmDeleteModal integration tests — W029
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { server } from "../mocks/server";
import { http, HttpResponse } from "msw";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

const BASE = "http://localhost";
const CID = "test-cid";

beforeEach(() => {
  vi.stubGlobal("location", { href: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConfirmDeleteModal", () => {
  it("opens the modal on button click", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("delete button is disabled until 'DELETE' is typed", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));

    const deleteBtn = screen.getByRole("button", { name: /permanently delete/i });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    expect(deleteBtn).not.toBeDisabled();
  });

  it("redirects to /deleted after successful deletion", async () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));

    await waitFor(() => expect(window.location.href).toBe("/deleted"), { timeout: 4000 });
  });

  it("shows error message when deletion fails", async () => {
    server.use(http.delete("*/api/user", () => new HttpResponse(null, { status: 500 })));

    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));

    await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(screen.getByText(/deletion failed/i)).toBeInTheDocument();
  });

  it("closes the modal and resets on cancel", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDeleteModal", () => {
  it("opens the modal on button click", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("delete button is disabled until 'DELETE' is typed", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));

    const deleteBtn = screen.getByRole("button", { name: /permanently delete/i });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    expect(deleteBtn).not.toBeDisabled();
  });

  it("redirects to /deleted after successful deletion", async () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));

    await waitFor(() => expect(window.location.href).toBe("/deleted"), { timeout: 4000 });
  });

  it("shows error message when deletion fails", async () => {
    server.use(http.delete("*/api/user", () => new HttpResponse(null, { status: 500 })));

    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/confirm deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));

    await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(screen.getByText(/deletion failed/i)).toBeInTheDocument();
  });

  it("closes the modal and resets on cancel", () => {
    render(<ConfirmDeleteModal apiBaseUrl={BASE} correlationId={CID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
