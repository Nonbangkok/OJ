// The naive-but-correct counterpart the harness asks every problem to carry.
//
// Validating the heap property means looking at every element, so there is no
// faster class of solution to separate here: meta.json sets
// "has_tle_subtask": false and verify.py skips the TLE check. This version is
// genuinely correct but does O(n log n) work instead of O(n) — for every
// element it walks all the way up the ancestor chain instead of looking at
// the parent only. It must reproduce the reference's outputs exactly.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
bool CP::priority_queue<T, Comp>::is_heap() const
{
  for (size_t c = 1; c < mSize; c++)
  {
    size_t node = c;
    while (node > 0)
    {
      size_t parent = (node - 1) / 2;
      if (mLess(mData[parent], mData[node]))
        return false;
      node = parent;
    }
  }
  return true;
}

#endif
