from datetime import time

SLOTS = {
    1: (time(8, 30),  time(9, 15)),
    2: (time(9, 30),  time(10, 15)),
    3: (time(10, 30), time(11, 15)),
    4: (time(11, 30), time(12, 15)),
    5: (time(12, 30), time(13, 15)),
    6: (time(13, 30), time(14, 15)),
    7: (time(14, 30), time(15, 15)),
    8: (time(15, 30), time(16, 15)),
    9: (time(16, 30), time(17, 15))
}
def slot_range_to_times(start_slot: int, slot_count: int) -> tuple[time, time]:
    """
    verilen slot aralığı için başlangıç ve bitiş saatlerini döndürür.
    """
    end_slot = start_slot + slot_count - 1
    if start_slot not in SLOTS or end_slot not in SLOTS:
        raise ValueError("Invalid slot number")
    if start_slot > end_slot:
        raise ValueError("Start slot must be less than or equal to end slot")
    
    start_time = SLOTS[start_slot][0]
    end_time = SLOTS[end_slot][1]
    
    return start_time, end_time 
