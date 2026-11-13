// Reference solution.
//
// Validation first, and it is written to be safe on unsigned arithmetic:
// `i + len` could wrap around for a huge len, so the tests are phrased as
// `len > mSize` and `i > mSize - len`, which never overflow.
//
// Overlap: with lo = min(i, j) and hi = max(i, j), the two ranges are
// disjoint exactly when hi - lo >= len. That single test also rules out
// i == j (hi - lo == 0 < len), which the problem calls a no-op.
//
// The swap itself touches 2 * len elements and nothing else: O(len) time and
// one temporary element of extra memory, no scratch buffer.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::block_swap(size_t i, size_t j, size_t len)
{
  // Your code here
  if (len == 0 || len > mSize)
  {
    return;
  }
  if (i > mSize - len || j > mSize - len)
  {
    return;
  }
  size_t lo = i < j ? i : j;
  size_t hi = i < j ? j : i;
  if (hi - lo < len)
  {
    return;
  }
  for (size_t k = 0; k < len; k++)
  {
    T hold = mData[lo + k];
    mData[lo + k] = mData[hi + k];
    mData[hi + k] = hold;
  }
}

#endif
