// Reference solution: one left-to-right compaction pass.
//
// `read` walks every element once, `write` points at the next free slot, and
// `next` walks the (ascending) position list. An element is copied forward
// only when its index is not the next position to delete, so each surviving
// element moves exactly once: O(n + k) in total, with no extra memory.
//
// The naive alternative — call a single-element erase once per position — is
// O(k * n), because every one of those calls shifts the whole tail again. See
// slow.h.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::erase_many(const std::vector<size_t> &positions)
{
  // Your code here
  size_t count = positions.size();
  if (count == 0)
  {
    return;
  }
  size_t write = 0;
  size_t next = 0;
  for (size_t read = 0; read < mSize; read++)
  {
    if (next < count && positions[next] == read)
    {
      next++;
      continue;
    }
    if (write != read)
    {
      mData[write] = mData[read];
    }
    write++;
  }
  mSize = write;
}

#endif
