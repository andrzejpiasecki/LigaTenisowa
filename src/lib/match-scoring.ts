export function isFivePointWin(resultText: string, firstSetText: string, secondSetText: string) {
  const result = resultText.match(/(\d+)\s*:\s*(\d+)/);
  const firstSet = firstSetText.match(/(\d+)\s*:\s*(\d+)/);
  const secondSet = secondSetText.match(/(\d+)\s*:\s*(\d+)/);

  return Boolean(
    result && Number(result[1]) === 2 && Number(result[2]) === 0
    && firstSet && secondSet && Number(firstSet[2]) + Number(secondSet[2]) < 4,
  );
}
