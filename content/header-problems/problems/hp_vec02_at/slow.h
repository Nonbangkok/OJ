// Deliberately naive reference: correct, but it reaches element `index` by
// walking an iterator from begin() instead of indexing mData, so one access
// costs Theta(index).
//
// meta.json sets "has_tle_subtask": false, so verify.py does NOT require this
// to time out. Bounds-checked indexing is Theta(1) in every implementation a
// student would plausibly write — there is no honest naive version in a
// different complexity class — so the large subtask here buys scale and the
// three index regions, not a complexity separation. The file is kept correct
// so that flipping the flag would be the only change needed to promote the
// problem.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
T &CP::vector<T>::at(size_t index)
{
  rangeCheck(index);
  iterator it = begin();
  for (size_t step = 0; step < index; step++)
  {
    ++it;
  }
  return *it;
}

template <typename T>
const T &CP::vector<T>::at(size_t index) const
{
  rangeCheck(index);
  const T *it = &mData[0];
  for (size_t step = 0; step < index; step++)
  {
    ++it;
  }
  return *it;
}

#endif
