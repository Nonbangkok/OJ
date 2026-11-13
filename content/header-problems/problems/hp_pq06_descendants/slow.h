// Deliberately naive reference: correct, but it counts the descendants by
// WALKING the subtree, one node at a time.
//
// The walk uses no extra storage (it follows the "leftmost descendant at each
// level" trick to enumerate the subtree level by level, node by node), so it
// is a plausible thing to write — it is simply Theta(subtree size) instead of
// O(log n), and the grader asks about indices near the root, where the
// subtree is most of the array.
//
// It must produce exactly the reference's outputs and only be too slow:
// verify.py requires it to pass the first subtask and time out on the first
// case of the last one.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
size_t CP::priority_queue<T, Comp>::descendants(size_t i) const
{
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  size_t count = 0;
  size_t left = 2 * i + 1;
  size_t right = 2 * i + 2;
  while (left < mSize)
  {
    for (size_t node = left; node < mSize && node <= right; node++)
      count++;
    left = 2 * left + 1;
    right = 2 * right + 2;
  }
  return count;
}

#endif
