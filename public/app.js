// Buttons that need JavaScript start hidden.
for (const button of document.querySelectorAll("[data-copy]")) {
  if (!navigator.clipboard) continue;
  button.hidden = false;
  const label = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Couldn't copy";
    }
    setTimeout(() => (button.textContent = label), 2000);
  });
}

for (const button of document.querySelectorAll("[data-share]")) {
  if (!navigator.share) continue;
  button.hidden = false;
  // Rejects when the person closes the share sheet, which is fine.
  button.addEventListener("click", () => navigator.share({ text: button.dataset.share }).catch(() => {}));
}
