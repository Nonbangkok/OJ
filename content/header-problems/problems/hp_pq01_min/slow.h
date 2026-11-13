// The naive-but-correct counterpart the harness asks every problem to carry.
//
// min() has to look at Omega(n) elements however it is written, so this
// problem has no complexity subtask: meta.json sets "has_tle_subtask": false
// and verify.py skips the TLE check. The file still has to exist, so it holds
// a genuinely correct version that simply does twice the work — it scans the
// whole array instead of the leaves only. It therefore reproduces the
// reference's outputs exactly; it is wasteful, never wrong.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
const T &CP::priority_queue<T, Comp>::min() const
{
  if (mSize == 0)
    throw std::out_of_range("index out of range");

  size_t best = 0;
  for (size_t i = 1; i < mSize; i++)
  {
    if (mLess(mData[i], mData[best]))
      best = i;
  }
  return mData[best];
}

#endif
