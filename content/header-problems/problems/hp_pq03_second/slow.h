// Deliberately naive reference: correct, but it finds the second most
// important element by scanning the whole array — Theta(n) per call instead
// of O(1).
//
// It must produce exactly the reference's outputs and only be too slow. That
// is the point: verify.py requires it to pass the first subtask and time out
// on the first case of the last one, which proves the large cases really do
// separate an O(1) answer from a scan.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::second() const
{
  if (mSize < 2)
    throw std::out_of_range("index out of range");

  size_t best = 0;
  for (size_t i = 1; i < mSize; i++)
  {
    if (mLess(mData[best], mData[i]))
      best = i;
  }

  size_t runner = (best == 0) ? 1 : 0;
  for (size_t i = 0; i < mSize; i++)
  {
    if (i == best)
      continue;
    if (mLess(mData[runner], mData[i]))
      runner = i;
  }
  return mData[runner];
}

#endif
