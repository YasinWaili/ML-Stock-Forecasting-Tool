from __future__ import annotations

import numpy as np
import pandas as pd


def largest_triangle_three_buckets(
    frame: pd.DataFrame,
    threshold: int,
    value_column: str = "Close",
) -> pd.DataFrame:
    """Downsample a time series in O(n) while preserving its visual shape.

    LTTB keeps the first and last observations and selects the point with the
    largest triangle area in each bucket. This retains peaks and turning points
    far better than taking every nth row.
    """

    length = len(frame)
    if threshold >= length or threshold <= 0:
        return frame
    if threshold < 3:
        raise ValueError("LTTB requires a threshold of at least three points.")

    values = frame[value_column].to_numpy(dtype=float, copy=False)
    x_values = np.arange(length, dtype=float)
    bucket_width = (length - 2) / (threshold - 2)
    sampled_indices = np.empty(threshold, dtype=np.int64)
    sampled_indices[0] = 0
    sampled_indices[-1] = length - 1

    selected_index = 0
    for bucket in range(threshold - 2):
        average_start = int(np.floor((bucket + 1) * bucket_width)) + 1
        average_end = int(np.floor((bucket + 2) * bucket_width)) + 1
        average_end = min(average_end, length)
        if average_start >= average_end:
            average_start = min(average_start, length - 1)
            average_end = min(average_start + 1, length)

        average_x = float(np.mean(x_values[average_start:average_end]))
        average_y = float(np.mean(values[average_start:average_end]))

        range_start = int(np.floor(bucket * bucket_width)) + 1
        range_end = int(np.floor((bucket + 1) * bucket_width)) + 1
        range_end = min(range_end, length - 1)

        point_x = x_values[selected_index]
        point_y = values[selected_index]
        candidate_x = x_values[range_start:range_end]
        candidate_y = values[range_start:range_end]
        triangle_areas = np.abs(
            (point_x - average_x) * (candidate_y - point_y)
            - (point_x - candidate_x) * (average_y - point_y)
        )

        next_index = (
            range_start + int(np.argmax(triangle_areas))
            if len(triangle_areas)
            else range_start
        )
        sampled_indices[bucket + 1] = next_index
        selected_index = next_index

    return frame.iloc[sampled_indices]
