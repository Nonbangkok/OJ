// Reference solution: one pass with two indices.
//
// `write` is the number of elements kept so far, so mData[write - 1] is the
// last element kept — which is also the value of the run currently being
// skipped. An element is kept only when it differs from that one, so each
// surviving element is copied at most once: O(n) time, O(1) extra memory.
//
// Comparing against mData[write - 1] rather than against mData[read - 1] is
// the same thing here (everything skipped in between equals the last kept
// element), and it is what makes the pass work in place.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::compress()
{
  // Your code here
  if (mSize == 0)
  {
    return;
  }
  size_t write = 1;
  for (size_t read = 1; read < mSize; read++)
  {
    if (!(mData[read] == mData[write - 1]))
    {
      if (write != read)
      {
        mData[write] = mData[read];
      }
      write++;
    }
  }
  mSize = write;
}

#endif
