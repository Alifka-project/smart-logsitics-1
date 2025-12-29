export function assignPriorities(deliveries) {
  // Sort by distance
  const sorted = [...deliveries].sort((a, b) => 
    a.distanceFromWarehouse - b.distanceFromWarehouse
  );
  
  // Assign priorities in thirds
  const third = Math.ceil(sorted.length / 3);
  
  return sorted.map((delivery, index) => {
    if (index < third) {
      return { ...delivery, priority: 1, priorityLabel: 'High - Closest' };
    } else if (index < third * 2) {
      return { ...delivery, priority: 2, priorityLabel: 'Medium - Mid Distance' };
    } else {
      return { ...delivery, priority: 3, priorityLabel: 'Low - Furthest' };
    }
  });
}


