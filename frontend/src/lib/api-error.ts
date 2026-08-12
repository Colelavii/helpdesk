import axios from "axios";

// Backend handlers respond with `{ error: string }`, so a failed request usually
// carries copy worth showing. Network failures and unexpected payloads don't —
// those fall back to the caller's message.
export function apiErrorMessage(error: unknown, fallback: string): string {
  return axios.isAxiosError(error) &&
    typeof error.response?.data?.error === "string"
    ? error.response.data.error
    : fallback;
}
