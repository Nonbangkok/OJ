// Reference solution: grow a FRONTIER of candidates, k steps of O(log k).
//
// The k-th most important element cannot hide deep in the tree without its
// ancestors being more important than it, and all of those are extracted
// before it. So run this k times:
//
//     take the most important candidate index, then offer its two children
//
// starting from the single candidate 0. The element taken on step k is the
// answer. At most k+1 indices are ever candidates (each step removes one and
// adds two), so a candidate heap of size O(k) suffices and every step is
// O(log k): O(k log k) in total, with no dependence on mSize at all beyond
// the bounds check.
//
// The candidate heap is a heap OF INDICES ordered by the elements they point
// at — mLess(mData[a], mData[b]) — and it has to be written out by hand here,
// since the class's own fixUp/fixDown work on mData. It lives in a local
// array that is released before returning, and mData is never written to:
// kth() is a const member and the grader keeps using the heap afterwards.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::kth(size_t k) const
{
  // Your code here
  if (k == 0 || k > mSize)
    throw std::out_of_range("index out of range");
  if (k == 1)
    return mData[0];

  size_t *candidate = new size_t[2 * k + 2];
  size_t count = 0;
  candidate[count++] = 0;

  T answer = mData[0];
  for (size_t step = 0; step < k; step++)
  {
    size_t best = candidate[0];
    answer = mData[best];

    // Remove the candidate heap's root: last one up front, then sift down.
    count--;
    candidate[0] = candidate[count];
    size_t node = 0;
    while (true)
    {
      size_t child = 2 * node + 1;
      if (child >= count)
        break;
      if (child + 1 < count && mLess(mData[candidate[child]], mData[candidate[child + 1]]))
        child++;
      if (!mLess(mData[candidate[node]], mData[candidate[child]]))
        break;
      size_t hold = candidate[node];
      candidate[node] = candidate[child];
      candidate[child] = hold;
      node = child;
    }

    if (step + 1 == k)
      break;

    // Offer the children of the index just taken.
    for (size_t child = 2 * best + 1; child <= 2 * best + 2; child++)
    {
      if (child >= mSize)
        continue;
      candidate[count] = child;
      size_t idx = count;
      count++;
      while (idx > 0)
      {
        size_t parent = (idx - 1) / 2;
        if (!mLess(mData[candidate[parent]], mData[candidate[idx]]))
          break;
        size_t hold = candidate[parent];
        candidate[parent] = candidate[idx];
        candidate[idx] = hold;
        idx = parent;
      }
    }
  }

  delete[] candidate;
  return answer;
}

#endif
