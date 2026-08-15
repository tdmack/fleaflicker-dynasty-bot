/** Read a named option value from a slash-command interaction. */
export function getOption(interaction, name) {
  const options = interaction.data?.options || [];
  const match = options.find((o) => o.name === name);
  return match ? match.value : undefined;
}
