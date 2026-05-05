export const formatCurrency = (amount: number): string => {
  const formatted = new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    currencyDisplay: 'symbol'
  }).format(amount);
  
  // Replace generic $ with explicit NT$
  return formatted.replace(/^\$/, 'NT$ ');
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};
