/** Opens the browser print dialog (Save as PDF) for one truck segment. */
export function printRoutePdf(segmentId: string): void {
  const segments = document.querySelectorAll<HTMLElement>(".route-print-segment");

  segments.forEach((segment) => {
    segment.classList.toggle(
      "route-print-segment--hidden",
      segment.dataset.segmentId !== segmentId
    );
  });

  document.body.classList.add("route-print-active");

  const cleanup = () => {
    document.body.classList.remove("route-print-active");
    segments.forEach((segment) => segment.classList.remove("route-print-segment--hidden"));
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.print();
}
